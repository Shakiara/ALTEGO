// ALTEGO necesita resolver la memoria de filtros de cada página de la tienda.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,effect,inject,signal} from '@angular/core';
import {AuthService} from "../../core/auth/auth-service";

@Injectable({providedIn:'root'})
export class StorefrontFilterState{
 collection=signal(0);favorites=signal(0);private actor:number|null=null;
 constructor(){const auth=inject(AuthService);effect(()=>{const actor=auth.user()?.id??null;if(actor!==this.actor){this.actor=actor;this.favorites.set(0);}});}
}
