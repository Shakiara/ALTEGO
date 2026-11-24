// ALTEGO necesita resolver el resumen del espacio administrativo.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,inject,signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {AuthService} from "../../core/auth/auth-service";
import {errorMessage} from "../../core/http/api";
import {GlassPanel,VisualButton} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";

interface WorkspaceCounts {accounts:number;moderators:number;suspended:number;warnings:number;}
@Component({selector:'app-admin-overview',imports:[GlassPanel,VisualButton,RouterLink,Icon],templateUrl:'./admin-overview.html',styleUrl:'./admin-overview.css'})
export class AdminOverview{
 auth=inject(AuthService);private http=inject(HttpClient);private destroy=inject(DestroyRef);
 counts=signal<WorkspaceCounts|null>(null);error=signal('');loading=signal(false);
 constructor(){this.load();}
 load(){this.error.set('');this.loading.set(true);this.http.get<WorkspaceCounts>('/api/admin/workspace').pipe(takeUntilDestroyed(this.destroy)).subscribe({
  next:counts=>{this.counts.set(counts);this.loading.set(false);},error:error=>{this.error.set(errorMessage(error));this.loading.set(false);}
 });}
}
