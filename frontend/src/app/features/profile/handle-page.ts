// ALTEGO necesita resolver la resolución de alias hacia una identidad de cuenta estable.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,inject,signal} from '@angular/core';
import {ActivatedRoute,Router} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Api} from "../../core/http/api";
import {GlassPanel,VisualButton} from "../../shared/ui/visual-primitives";


@Component({selector:'app-handle-page',imports:[GlassPanel,VisualButton],template:`<section appGlass class="handle-page">@if(error()){<h1>{{error()}}</h1><button appButton class="button" type="button" (click)="load()">Try Again</button>}@else{<p role="status">Opening profile…</p>}</section>`,styles:`.handle-page{margin:36px auto;padding:28px;max-width:640px}.handle-page h1{font-size:26px}`})
export class HandlePage{
 private api=inject(Api);private route=inject(ActivatedRoute);private router=inject(Router);private request=0;private destroyed=false;error=signal('');
 constructor(){this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(()=>this.load());}
 load(){const token=++this.request;this.error.set('');this.api.resolveHandle(this.route.snapshot.paramMap.get('username')||'').subscribe({next:creator=>{if(!this.destroyed&&token===this.request)void this.router.navigate(['/creators',creator.id],{replaceUrl:true,queryParams:this.route.snapshot.queryParams});},error:error=>{if(!this.destroyed&&token===this.request)this.error.set(error.status===404?'Creator not found.':'Could not open this profile.');}});}
 ngOnDestroy(){this.destroyed=true;this.request++;}
}
