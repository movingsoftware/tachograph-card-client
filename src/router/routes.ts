import type { RouteRecordRaw } from 'vue-router'
import { ROUTES } from '../enums/routes'

const routes: RouteRecordRaw[] = [
    {
        path: ROUTES.LAUNCH,
        component: () => import('layouts/BaseLayout.vue'),
        children: [
            {
                path: '',
                component: () => import('layouts/BlankLayout.vue'),
                children: [
                    {
                        path: '',
                        component: () => import('pages/LaunchingScreen.vue'),
                    },
                ],
            },
            {
                path: 'errors/outdated',
                component: () => import('layouts/BlankLayout.vue'),
                children: [
                    {
                        path: '',
                        component: () => import('pages/errors/Outdated.vue'),
                    },
                ],
            },
            {
                path: 'errors/maintenance',
                component: () => import('layouts/BlankLayout.vue'),
                children: [
                    {
                        path: '',
                        component: () => import('pages/errors/Maintenance.vue'),
                    },
                ],
            },
            {
                path: 'offline',
                component: () => import('layouts/BlankLayout.vue'),
                children: [
                    {
                        path: '',
                        component: () => import('pages/errors/Offline.vue'),
                    },
                ],
            },
            {
                path: 'app',
                component: () => import('layouts/AppLayout.vue'),
                children: [
                    {
                        path: 'auth',
                        component: () => import('pages/app/AuthScreen.vue'),
                    },
                    {
                        path: 'home',
                        component: () => import('pages/app/HomeScreen.vue'),
                    },
                ],
            },
            {
                path: ':catchAll(.*)*',
                component: () => import('layouts/BlankLayout.vue'),
                children: [
                    {
                        path: '',
                        component: () => import('pages/errors/NotFound.vue'),
                    },
                ],
            },
        ],
    },
]

export default routes
