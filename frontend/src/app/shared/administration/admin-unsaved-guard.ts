// ALTEGO necesita resolver la protección de formularios administrativos sin guardar.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {inject} from '@angular/core';
import {CanDeactivateFn} from '@angular/router';
import {UiFeedback} from "../ui/ui-feedback";
export const adminUnsavedGuard:CanDeactivateFn<{dirty?:()=>boolean;isBusy?:()=>boolean}>=(component)=>{
 if(component.isBusy?.())return false;
 if(!document.querySelector('dialog[appAdminDialog][open]')||!component.dirty?.())return true;
 return inject(UiFeedback).confirm({dismissOnBackdrop:true,title:'Discard Unsaved Changes?',description:'Leave this administrative form without submitting the changes?',confirmLabel:'Discard Changes',danger:true});
};
