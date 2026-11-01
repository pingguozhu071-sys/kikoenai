// Kikoenai 的 Windows 媒体面板（SMTC）宿主。
// Electron 主进程启动本进程：stdin 收 "字段\t值" 行，stdout 回按钮事件。
// 只在 Windows 11 上真正显示，老系统上进程仍可运行（面板不出现）。
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
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

    /**
     * 媒体面板按 AUMID 去开始菜单里找快捷方式，找到才显示应用名和图标。
     * 这里确保 %APPDATA%\...\Start Menu\Programs\Kikoenai.lnk 存在且带同一个 AUMID。
     */
    void EnsureAumidShortcut()
    {
        wchar_t self[MAX_PATH] = {};
        if (!GetModuleFileNameW(nullptr, self, MAX_PATH)) return;

        std::wstring exe(self);
        for (int i = 0; i < 3; i++) // resources\smtc\Kikoenai.Media.exe -> 安装根目录
        {
            auto slash = exe.find_last_of(L"\\/");
            if (slash == std::wstring::npos) return;
            exe.erase(slash);
        }
        exe += L"\\Kikoenai.exe";
        if (GetFileAttributesW(exe.c_str()) == INVALID_FILE_ATTRIBUTES) return;

        wchar_t appdata[MAX_PATH] = {};
        if (FAILED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) return;
        std::wstring lnk = std::wstring(appdata) +
            L"\\Microsoft\\Windows\\Start Menu\\Programs\\Kikoenai.lnk";

        IShellLinkW* link = nullptr;
        if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&link))))
            return;
        link->SetPath(exe.c_str());
        link->SetIconLocation(exe.c_str(), 0);
        link->SetDescription(L"Kikoenai");

        IPropertyStore* store = nullptr;
        if (SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&store))))
        {
            PROPVARIANT pv;
            if (SUCCEEDED(InitPropVariantFromString(L"Kikoenai.Player", &pv)))
            {
                store->SetValue(PKEY_AppUserModel_ID, pv);
                store->Commit();
                PropVariantClear(&pv);
            }
            store->Release();
        }

        IPersistFile* file = nullptr;
        if (SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&file))))
        {
            file->Save(lnk.c_str(), TRUE);
            file->Release();
        }
        link->Release();
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
    EnsureAumidShortcut();

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
