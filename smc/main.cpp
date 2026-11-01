// Kikoenai 的 Windows 媒体面板（SMTC）宿主。
// Electron 主进程启动本进程：stdin 收 "字段\t值" 行，stdout 回按钮事件。
// 只在 Windows 11 上真正显示，老系统上进程仍可运行（面板不出现）。
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <shellapi.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <chrono>
#include <iostream>
#include <string>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Media;
using namespace Windows::Media::Playback;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;

namespace
{
    bool g_playing = false;
    double g_posMs = 0;
    double g_durMs = 0;

    hstring Utf8ToH(const std::string& s)
    {
        if (s.empty()) return hstring();
        int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
        std::wstring w((size_t)len, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), w.data(), len);
        return hstring(w);
    }

    void SetAumid(const wchar_t* id)
    {
        using Fn = HRESULT(WINAPI*)(PCWSTR);
        HMODULE shell = GetModuleHandleW(L"shell32.dll");
        if (!shell) return;
        auto fn = reinterpret_cast<Fn>(GetProcAddress(shell, "SetCurrentProcessExplicitAppUserModelID"));
        if (fn) fn(id);
    }

    void Emit(const std::string& line)
    {
        std::cout << line << '\n' << std::flush;
    }

    TimeSpan MsToTs(double ms)
    {
        return std::chrono::duration_cast<TimeSpan>(std::chrono::milliseconds((long long)ms));
    }

    void UpdateTimeline(const SystemMediaTransportControls& smtc)
    {
        double max = g_durMs > 0 ? g_durMs : 0;
        double pos = g_posMs;
        if (pos < 0) pos = 0;
        if (pos > max) pos = max;

        SystemMediaTransportControlsTimelineProperties tl;
        tl.StartTime(TimeSpan{});
        tl.MinSeekTime(TimeSpan{});
        tl.MaxSeekTime(MsToTs(max));
        tl.EndTime(MsToTs(max));
        tl.Position(MsToTs(pos));
        smtc.UpdateTimelineProperties(tl);
    }

    void ApplyCover(const SystemMediaTransportControls& smtc, const std::string& path)
    {
        if (path.empty()) return;
        try
        {
            auto file = StorageFile::GetFileFromPathAsync(Utf8ToH(path)).get();
            smtc.DisplayUpdater().Thumbnail(RandomAccessStreamReference::CreateFromFile(file));
            smtc.DisplayUpdater().Update();
        }
        catch (...) { /* 封面读不到就不显示 */ }
    }
}

int main()
{
    try { init_apartment(apartment_type::multi_threaded); } catch (...) { return 0; }
    SetAumid(L"Kikoenai.Player");

    MediaPlayer player;
    player.CommandManager().IsEnabled(false);
    auto smtc = player.SystemMediaTransportControls();
    smtc.IsEnabled(true);
    smtc.DisplayUpdater().Type(MediaPlaybackType::Music);

    smtc.ButtonPressed([](auto const&, SystemMediaTransportControlsButtonPressedEventArgs const& e)
    {
        std::string cmd;
        switch (e.Button())
        {
        case SystemMediaTransportControlsButton::Play:
            if (!g_playing) cmd = "toggle";
            break;
        case SystemMediaTransportControlsButton::Pause:
            if (g_playing) cmd = "toggle";
            break;
        case SystemMediaTransportControlsButton::Next:
            cmd = "next";
            break;
        case SystemMediaTransportControlsButton::Previous:
            cmd = "prev";
            break;
        case SystemMediaTransportControlsButton::Stop:
            if (g_playing) cmd = "toggle";
            break;
        }
        if (!cmd.empty()) Emit(cmd);
    });

    smtc.PlaybackPositionChangeRequested([](auto const&, PlaybackPositionChangeRequestedEventArgs const& e)
    {
        long long ms = (long long)(e.RequestedPlaybackPosition().count() / 10000);
        Emit("seek-to\t" + std::to_string(ms));
    });

    std::string line;
    while (std::getline(std::cin, line))
    {
        if (line.empty()) continue;
        auto tab = line.find('\t');
        std::string key = tab == std::string::npos ? line : line.substr(0, tab);
        std::string val = tab == std::string::npos ? std::string() : line.substr(tab + 1);

        try
        {
            auto music = smtc.DisplayUpdater().MusicProperties();
            if (key == "T") music.Title(Utf8ToH(val));
            else if (key == "A") music.Artist(Utf8ToH(val));
            else if (key == "B") music.AlbumTitle(Utf8ToH(val));
            else if (key == "P")
            {
                g_playing = (val == "1");
                smtc.PlaybackStatus(g_playing ? MediaPlaybackStatus::Playing : MediaPlaybackStatus::Paused);
                smtc.IsPlayEnabled(!g_playing);
                smtc.IsPauseEnabled(g_playing);
            }
            else if (key == "NX") smtc.IsNextEnabled(val == "1");
            else if (key == "PV") smtc.IsPreviousEnabled(val == "1");
            else if (key == "POS") { g_posMs = atof(val.c_str()); UpdateTimeline(smtc); }
            else if (key == "DUR") { g_durMs = atof(val.c_str()); UpdateTimeline(smtc); }
            else if (key == "C") ApplyCover(smtc, val);
            else if (key == "Q") break;

            smtc.DisplayUpdater().Update();
        }
        catch (...) { /* 单条失败继续 */ }
    }

    try { smtc.IsEnabled(false); } catch (...) { }
    return 0;
}
