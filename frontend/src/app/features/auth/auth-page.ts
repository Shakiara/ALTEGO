// ALTEGO necesita resolver los formularios de inicio de sesión y registro.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {DatePipe,TitleCasePipe} from '@angular/common';
import {Component,inject,signal} from '@angular/core';
import {FormsModule,NgForm} from '@angular/forms';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {AuthService} from "../../core/auth/auth-service";
import {errorMessage} from "../../core/http/api";
import {GlassPanel,VisualButton,VisualField} from "../../shared/ui/visual-primitives";
@Component({selector:'app-auth-page',imports:[DatePipe,TitleCasePipe,FormsModule,RouterLink,GlassPanel,VisualButton,VisualField],template:`
  <section appGlass class="auth-panel">
    <span class="eyebrow">ALTEGO ACCOUNT</span><h1>{{signup ? 'Create your account' : 'Welcome back'}}</h1>
    <p class="muted">Use fictional credentials only.</p>
    <form #form="ngForm" (ngSubmit)="submit(form)">
      @if(signup){
        <label>Username<input appField name="username" [(ngModel)]="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username"></label>
        <label>Email<input appField name="email" [(ngModel)]="email" type="email" required email maxlength="254" autocomplete="email"></label>
      }@else{<label>Username or email<input appField name="identifier" [(ngModel)]="identifier" required maxlength="254" autocomplete="username"></label>}
      <label>Password<input appField name="password" [(ngModel)]="password" type="password" required maxlength="128" [attr.autocomplete]="signup?'new-password':'current-password'"></label>
      @if(signup){<p class="field-help">Use 8–128 characters, uppercase, lowercase, a number and a special character.</p>}
      @else{<label class="remember-field"><input name="rememberMe" [(ngModel)]="rememberMe" type="checkbox"> Remember Me</label>}
      @if(error()){<p class="notice error" role="alert">{{error()}}</p>}
      <button appButton class="button dark" [disabled]="busy()||form.invalid">{{busy()?'Please wait…':signup?'Sign Up':'Log In'}}</button>
    </form>
    @if(sanctions().length){<section aria-labelledby="sign-in-sanctions"><h2 id="sign-in-sanctions">Account Status</h2>
      @for(sanction of sanctions();track sanction.id){
        <p><strong>{{sanction.kind==='suspension'?'Suspension':'Warning'}}</strong> · {{sanction.issued_at|date:'medium'}}<br>
        {{sanction.reason.replaceAll('_',' ')|titlecase}} @if(sanction.expires_at){· Ends {{sanction.expires_at|date:'medium'}}}
        @if(sanction.explanation){<br>{{sanction.explanation}}}</p>
      }
    </section>}
    @if(restricted()){<a appButton routerLink="/account/status">View Sanctions &amp; Appeals</a>}
    <p class="auth-switch">{{signup?'Already have an account?':'New to ALTEGO?'}} <a [routerLink]="signup?'/login':'/signup'">{{signup?'Log In':'Sign Up'}}</a></p>
  </section>`})
export class AuthPage {
  private auth=inject(AuthService);private route=inject(ActivatedRoute);private router=inject(Router);
  signup=this.route.snapshot.data['signup']===true;
  username='';email='';identifier='';password='';rememberMe=false;busy=signal(false);error=signal('');
  restricted=signal(false);
  sanctions=signal<{id:number;kind:string;reason:string;explanation:string|null;issued_at:string;expires_at:string|null}[]>([]);
  submit(form:NgForm){if(form.invalid||this.busy())return;this.busy.set(true);this.error.set('');this.sanctions.set([]);
    const request=this.signup?this.auth.register({username:this.username,email:this.email,password:this.password}):this.auth.login({identifier:this.identifier,password:this.password,rememberMe:this.rememberMe});
    request.subscribe({next:()=>{this.password='';const target=this.route.snapshot.queryParamMap.get('returnUrl');void this.router.navigateByUrl(target&&/^\/(products|account|admin|studio|my-items|settings|favorites|checkout|orders|collection)([/?#]|$)/.test(target)?target:'/account');},error:error=>{this.busy.set(false);this.error.set(errorMessage(error));if(error.error?.code==='ACCOUNT_SUSPENDED'&&Array.isArray(error.error.sanctions)){this.password='';this.sanctions.set(error.error.sanctions);this.restricted.set(error.error.restricted===true);}}});
  }
}
