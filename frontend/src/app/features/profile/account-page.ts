// ALTEGO necesita resolver la compatibilidad del acceso a la cuenta propia.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,inject} from '@angular/core';
import {Router} from '@angular/router';
import {AuthService} from "../../core/auth/auth-service";

@Component({selector:'app-account-page',template:'<p role="status">Opening your profile…</p>'})
export class AccountPage {constructor(){const user=inject(AuthService).user();void inject(Router).navigate(['/creators',user!.id],{replaceUrl:true});}}
