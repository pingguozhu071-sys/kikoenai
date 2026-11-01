import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './theme/style.css'
import { player, seek, beginScrub, scrubTo, endScrub } from './stores/player'
import { ui } from './stores/ui'

// 开发期调试钩子：便于在控制台/自动化里检查播放器状态
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__kikoeru = {
    player, seek, beginScrub, scrubTo, endScrub, ui,
  }
}

import HomeView from './views/HomeView.vue'
import SearchView from './views/SearchView.vue'
import WorkView from './views/WorkView.vue'
import LibraryView from './views/LibraryView.vue'
import PopularView from './views/PopularView.vue'
import BrowseView from './views/BrowseView.vue'
import CategoryListView from './views/CategoryListView.vue'
import SettingsView from './views/SettingsView.vue'
import RecommendView from './views/RecommendView.vue'
import PlaylistsView from './views/PlaylistsView.vue'
import DownloadsView from './views/DownloadsView.vue'
import DesktopLyrics from './views/DesktopLyrics.vue'
import TaskbarLyrics from './views/TaskbarLyrics.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/popular', component: PopularView },
    { path: '/recommend', component: RecommendView },
    { path: '/search', component: SearchView },
    { path: '/browse', component: BrowseView },
    { path: '/list/:kind/:id', component: CategoryListView },
    { path: '/work/:id', component: WorkView },
    { path: '/library', component: LibraryView },
    { path: '/playlists', component: PlaylistsView },
    { path: '/downloads', component: DownloadsView },
    // 旧链接兼容
    { path: '/review', redirect: '/library' },
    { path: '/settings', component: SettingsView },
    { path: '/desktop-lyrics', component: DesktopLyrics },
    { path: '/taskbar-lyrics', component: TaskbarLyrics },
    { path: '/login', redirect: '/' },
  ],
})

// 从详情页标签跳到搜索
router.beforeEach((to) => {
  if (to.path === '/search' && to.query.kw) {
    sessionStorage.setItem('kikoeru-pc/pendingKw', String(to.query.kw))
  }
})

createApp(App).use(router).mount('#app')
