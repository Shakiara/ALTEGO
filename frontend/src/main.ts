// ALTEGO necesita resolver el arranque y las rutas de Angular.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {adminUnsavedGuard} from "./app/shared/administration/admin-unsaved-guard";
import { sessionInterceptor, signedInGuard, adminGuard, workspaceGuard, studioGuard } from "./app/core/auth/auth-service";
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { App } from './app/app';
bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([sessionInterceptor])),
  provideRouter([
    { path: '', loadComponent: () => import("./app/features/catalog/catalog").then(m => m.Catalog) },
    { path: 'products/new', canActivate:[signedInGuard], canDeactivate:[(component: {canLeave:()=>boolean|Promise<boolean>})=>component.canLeave()], loadComponent: () => import("./app/features/products/product-form").then(m => m.ProductForm) },
    { path: 'products/:id/edit', canActivate:[signedInGuard], canDeactivate:[(component: {canLeave:()=>boolean|Promise<boolean>})=>component.canLeave()], loadComponent: () => import("./app/features/products/product-form").then(m => m.ProductForm) },
    { path: 'products/:id', loadComponent: () => import("./app/features/products/product-detail").then(m => m.ProductDetail) },
    { path:'login', loadComponent:()=>import("./app/features/auth/auth-page").then(m=>m.AuthPage) },
    { path:'signup', data:{signup:true}, loadComponent:()=>import("./app/features/auth/auth-page").then(m=>m.AuthPage) },
    { path:'my-items',redirectTo:'studio/products',pathMatch:'full' },
    { path:'creators/:id', runGuardsAndResolvers:'always',canDeactivate:[(component:{canLeave:()=>boolean|Promise<boolean>})=>component.canLeave()],loadComponent:()=>import("./app/features/profile/creator-profile-page").then(m=>m.CreatorProfilePage) },
    { path:'u/:username', loadComponent:()=>import("./app/features/profile/handle-page").then(m=>m.HandlePage) },
    {path:'checkout',canActivate:[signedInGuard],loadComponent:()=>import("./app/features/checkout/checkout-page").then(m=>m.CheckoutPage)},
    {path:'collection',canActivate:[signedInGuard],loadComponent:()=>import("./app/features/collection/collection-page").then(m=>m.CollectionPage)},
    {path:'orders',canActivate:[signedInGuard],loadComponent:()=>import("./app/features/orders/orders-page").then(m=>m.OrdersPage)},
    {path:'orders/:orderNumber/confirmation',canActivate:[signedInGuard],loadComponent:()=>import("./app/features/orders/order-confirmation").then(m=>m.OrderConfirmation)},
    { path:'settings', canActivate:[signedInGuard], loadComponent:()=>import("./app/features/settings/settings-page").then(m=>m.SettingsPage) },
    {path:'following',canActivate:[signedInGuard],loadComponent:()=>import("./app/features/feed/following-feed").then(m=>m.FollowingFeed)},
    {path:'following/publications/:publicId',loadComponent:()=>import("./app/features/feed/following-feed").then(m=>m.FollowingFeed)},
    { path:'discover-creators',loadComponent:()=>import("./app/features/creators/discover-creators").then(m=>m.DiscoverCreators) },
    { path:'favorites', canActivate:[signedInGuard], loadComponent:()=>import("./app/features/favorites/favorites-page").then(m=>m.FavoritesPage) },
    { path:'account/status',redirectTo:'studio/status',pathMatch:'full' },
    { path:'account', canActivate:[signedInGuard], loadComponent:()=>import("./app/features/profile/account-page").then(m=>m.AccountPage) },
    {path:'studio',canActivate:[studioGuard],canActivateChild:[studioGuard],loadComponent:()=>import("./app/features/studio/creator-studio").then(m=>m.CreatorStudio),children:[
     {path:'',pathMatch:'full',loadComponent:()=>import("./app/features/studio/studio-pages").then(m=>m.StudioDashboard)},
     {path:'storage',loadComponent:()=>import("./app/features/products/product-storage-page").then(m=>m.ProductStoragePage)},
     {path:'sales',loadComponent:()=>import("./app/features/studio/studio-sales").then(m=>m.StudioSales)},
     {path:'analytics',loadComponent:()=>import("./app/features/studio/studio-pages").then(m=>m.StudioAnalyticsPage)},
     {path:'products',loadComponent:()=>import("./app/features/studio/studio-products-page").then(m=>m.StudioProductsPage)},
     {path:'community',canDeactivate:[(component:{canLeave:()=>boolean|Promise<boolean>})=>component.canLeave()],loadComponent:()=>import("./app/features/studio/studio-pages").then(m=>m.StudioCommunity)},
     {path:'status',loadComponent:()=>import("./app/features/studio/account-status").then(m=>m.AccountStatus)},
     {path:'verification',loadComponent:()=>import("./app/features/studio/studio-pages").then(m=>m.StudioVerification)}
    ]},
    { path:'admin', canActivate:[signedInGuard,workspaceGuard], loadComponent:()=>import("./app/features/administration/admin-workspace").then(m=>m.AdminWorkspace), children:[
      {path:'',loadComponent:()=>import("./app/features/administration/admin-overview").then(m=>m.AdminOverview)},
      {path:'storage-quotas',canActivate:[adminGuard],loadComponent:()=>import("./app/features/administration/admin-storage-quotas").then(m=>m.AdminStorageQuotas)},
      {path:'catalog-filters',canActivate:[adminGuard],canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-catalog-filters").then(m=>m.AdminCatalogFilters)},
      {path:'accounts',canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-accounts").then(m=>m.AdminAccounts)},
      {path:'account-moderation',data:{disciplinary:true},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-accounts").then(m=>m.AdminAccounts)},
      {path:'feed-reports',data:{section:'feed'},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-governance-page").then(m=>m.AdminGovernancePage)},
      {path:'content',data:{section:'products'},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-governance-page").then(m=>m.AdminGovernancePage)},
      {path:'reports',redirectTo:'conversations',pathMatch:'full'},
      {path:'appeals',canActivate:[adminGuard],data:{section:'appeals'},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-governance-page").then(m=>m.AdminGovernancePage)},
      {path:'removed',data:{section:'removed'},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-governance-page").then(m=>m.AdminGovernancePage)},
      {path:'audit',data:{section:'audit'},canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-governance-page").then(m=>m.AdminGovernancePage)},
      {path:'conversations',canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/admin-conversations-page").then(m=>m.AdminConversationsPage)},
      {path:'verification',canActivate:[adminGuard],canDeactivate:[adminUnsavedGuard],loadComponent:()=>import("./app/features/administration/verification-admin").then(m=>m.VerificationAdmin)},
    ] },
    { path: '**', redirectTo: '' }
  ])
]}).catch(error => console.error(error));
