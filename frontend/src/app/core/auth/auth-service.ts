// ALTEGO necesita resolver el estado de autenticación y las guardas de navegación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom, tap, from, switchMap } from 'rxjs';


export const API_URL = '/api';
export interface User { id:number; username:string; email:string; role:'user'|'admin'|'moderator'; }
export const sessionInterceptor:HttpInterceptorFn=(request,next)=>next(request.url.startsWith(API_URL+'/')?request.clone({withCredentials:true}):request);
@Injectable({providedIn:'root'})
export class AuthService {
  private http=inject(HttpClient);
  user=signal<User|null>(null);
  loading=signal(true);
  ready=firstValueFrom(this.http.get<{user:User|null}>(API_URL+'/auth/me')).then(result=>this.user.set(result.user)).catch(()=>this.user.set(null)).finally(()=>this.loading.set(false));
  login(body:{identifier:string;password:string;rememberMe:boolean}){return from(this.ready).pipe(switchMap(()=>this.http.post<{user:User}>(API_URL+'/auth/login',body)),tap(result=>this.user.set(result.user)));}
  register(body:{username:string;email:string;password:string}){return from(this.ready).pipe(switchMap(()=>this.http.post<{user:User}>(API_URL+'/auth/register',{...body,username:body.username.toLowerCase()})),tap(result=>this.user.set(result.user)));}
  logout(){return this.http.post<void>(API_URL+'/auth/logout',{}).pipe(tap(()=>this.user.set(null)));}
  canEdit(owner:number|undefined){const user=this.user();return !!user&&(user.role==='admin'||user.id===owner);}
}
export const signedInGuard:CanActivateFn=async(_,state)=>{const auth=inject(AuthService);const router=inject(Router);await auth.ready;return auth.user()?true:router.createUrlTree(['/login'],{queryParams:{returnUrl:state.url}});};
export const workspaceGuard:CanActivateFn=async()=>{const auth=inject(AuthService);const router=inject(Router);await auth.ready;const role=auth.user()?.role;return role==='admin'||role==='moderator'?true:router.createUrlTree(['/account']);};
export const adminGuard:CanActivateFn=async()=>{const auth=inject(AuthService);const router=inject(Router);await auth.ready;return auth.user()?.role==='admin'?true:router.createUrlTree(['/account']);};

export const studioGuard:CanActivateFn=async(_,state)=>{const auth=inject(AuthService),router=inject(Router),http=inject(HttpClient);await auth.ready;if(auth.user())return true;try{const status=await firstValueFrom(http.get<{restricted:boolean}>('/api/account/sanctions'));if(status.restricted)return state.url.split(/[?#]/)[0]==='/studio/status'?true:router.createUrlTree(['/studio/status']);}catch{}return router.createUrlTree(['/login'],{queryParams:{returnUrl:state.url}});};
