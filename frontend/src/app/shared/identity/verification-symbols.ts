// ALTEGO necesita resolver los símbolos gráficos de verificación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component} from '@angular/core';
@Component({selector:'app-verification-border',templateUrl:'./verification-border.svg',styles:':host,svg{display:block;width:100%;height:100%}'})
export class VerificationBorder {}
@Component({selector:'app-verification-check',templateUrl:'./verification-check.svg',styles:':host,svg{display:block;width:100%;height:100%}'})
export class VerificationCheck {}
