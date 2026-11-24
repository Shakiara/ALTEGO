// ALTEGO necesita definir los contratos de datos del descubrimiento de creadores.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export interface DiscoveredCreator {id:number;username:string;display_name:string;bio:string|null;avatar_url:string|null;banner_url:string|null;banner_preset:string|null;published_items:number;followers:number;verified_creator:boolean;viewer_follows:boolean;social_restricted:boolean;own_account:boolean;follow_required:boolean;products:{id:number;name:string;model_url:string|null;texture_url:string|null}[];}
export interface CreatorDiscoveryPage {items:DiscoveredCreator[];total:number;page:number;pages:number;size:number;}
