// ALTEGO necesita resolver el registro explícito de iconos utilizados.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {IconDefinition} from '@fortawesome/fontawesome-svg-core';
import {faNewspaper,faBell,faReply,faSliders,faEllipsis,faUserXmark,faDesktop,faMobileScreenButton,faTabletScreenButton,faMagnifyingGlass,faBagShopping,faLock,faRotateLeft,faDownload,faPen,faTrashCan,faCamera,faLink,faBan,faXmark,faArrowLeft,faArrowRight,faArrowUp,faArrowDown,faChevronLeft,faChevronRight,faChevronDown,faPlus,faCircleInfo,faTriangleExclamation,faCube,faBorderAll,faHatCowboy,faThumbtack,faStar,faChartBar} from '@fortawesome/free-solid-svg-icons';
import {faComment,faUser,faHeart,faFlag,faCircleCheck,faCircleQuestion,faImage,faStar as faStarOutline} from '@fortawesome/free-regular-svg-icons';
import {faInstagram,faYoutube,faTiktok,faRobloxCreatorStudio,faXTwitter,faTwitch,faDiscord,faGithub} from '@fortawesome/free-brands-svg-icons';


export const iconDefinitions:Readonly<Record<string,IconDefinition>>={
 feed:faNewspaper,bell:faBell,reply:faReply,comment:faComment,filter:faSliders,more:faEllipsis,'user-x':faUserXmark,desktop:faDesktop,mobile:faMobileScreenButton,tablet:faTabletScreenButton,user:faUser,search:faMagnifyingGlass,bag:faBagShopping,heart:faHeart,lock:faLock,restore:faRotateLeft,download:faDownload,edit:faPen,trash:faTrashCan,camera:faCamera,link:faLink,block:faBan,close:faXmark,
 'arrow-left':faArrowLeft,'arrow-right':faArrowRight,'arrow-up':faArrowUp,'arrow-down':faArrowDown,'chevron-left':faChevronLeft,'chevron-right':faChevronRight,'chevron-down':faChevronDown,plus:faPlus,info:faCircleInfo,warning:faTriangleExclamation,success:faCircleCheck,cube:faCube,grid:faBorderAll,hat:faHatCowboy,'pin-solid':faThumbtack,star:faStar,'star-outline':faStarOutline,explore:faArrowRight,
 instagram:faInstagram,youtube:faYoutube,tiktok:faTiktok,roblox:faRobloxCreatorStudio,x:faXTwitter,twitch:faTwitch,discord:faDiscord,github:faGithub,flag:faFlag,image:faImage,poll:faChartBar,unknown:faCircleQuestion
};

export const customIconNames=new Set(['pin','hair','accessories']);
