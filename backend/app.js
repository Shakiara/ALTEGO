// ALTEGO necesita resolver la navegación y la estructura principal de la aplicación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {installMyCollection} from './modules/collection/my-collection.js';
import {installSalesInsights} from './modules/studio/sales-insights.js';
import {installOrderDownloads} from './modules/commerce/order-download.js';
import {installCheckout} from './modules/commerce/checkout.js';
import {installFollowingFeed} from './modules/discovery/following-feed.js';
import {installTemporaryLifecycle} from './infrastructure/storage/upload-retention.js';
import {installShoppingBag} from './modules/commerce/shopping-bag.js';
import {installStorageQuotas} from './infrastructure/storage/storage-quotas.js';
import {reconcileConversationStorage} from './modules/conversations/conversation-storage.js';
import {configureStorageIdentity,refreshCreatorInformation} from './infrastructure/storage/storage-identity.js';
import {storageRoot} from './infrastructure/storage/storage-resolver.js';
import {installCreatorDiscovery} from './modules/discovery/creator-discovery.js';
import {installCatalogCategories} from './modules/catalog/catalog-categories.js';
import {installSocialLists} from './modules/social/social-lists.js';
import {installFavorites} from './modules/favorites/favorites.js';
import {installCreatorStudio} from './modules/studio/creator-studio.js';
import {installAdminGovernance} from './modules/administration/admin-governance.js';
import {installAdminFoundation} from './modules/administration/admin-foundation.js';
import {installCreatorVerification} from './modules/verification/creator-verification.js';
import {installAccountActivity} from './modules/accounts/account-activity.js';
import {installBlocking} from './modules/accounts/blocking.js';
import {installProfiles} from './modules/accounts/profiles.js';
import {installConversationEngagement} from './modules/conversations/conversation-engagement.js';
import {installSocialAccounts} from './modules/social/social-notifications.js';
import {installConversationPosts} from './modules/conversations/conversation-posts.js';
import {installConversationModeration} from './modules/conversations/conversation-moderation.js';
import {installAccountSettings} from './modules/accounts/account-settings.js';
import {installAccountMutations} from './modules/accounts/account-mutations.js';
import {installActiveSessions} from './modules/accounts/active-sessions.js';
import {installSecurity} from './modules/accounts/security.js';
import {installReviews} from './modules/reviews/reviews.js';
import { installProducts } from './modules/products/products.js';
import { installAuth, requireUser, frontendOrigins } from './modules/accounts/auth.js';
import express from 'express';
import cors from 'cors';
import { id } from './core/validation.js';



export function createApp(sql, mongo, options={}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ credentials: true, origin: [...frontendOrigins] }));
  app.use(express.json({ limit: '32kb' }));
  const storageReady=configureStorageIdentity(sql);
  let refreshingInfo=false,allInfo=false;const dirtyOwners=new Set();
  const refreshInfo=async(req)=>{if(req.user)dirtyOwners.add(req.user.id);if(req.recordId)dirtyOwners.add(req.recordId);
   if(req.path.startsWith('/api/admin'))allInfo=true;
   if(req.recordId){const [products]=await sql.execute('SELECT owner_id FROM productos WHERE id=?',[req.recordId]);for(const p of products)dirtyOwners.add(p.owner_id);}
   if(/\/conversation/.test(req.path))allInfo=true;
   if(refreshingInfo)return;refreshingInfo=true;
   try{do{const owners=allInfo?null:[...dirtyOwners];dirtyOwners.clear();allInfo=false;await reconcileConversationStorage(sql);await refreshCreatorInformation(sql,storageRoot,{owners,mongo});}while(dirtyOwners.size||allInfo);}
   catch(error){console.error('Creator information refresh:',error.code||error.name);}finally{refreshingInfo=false;}
  };
  app.use(async(req,res,next)=>{await storageReady;if(!['GET','HEAD','OPTIONS'].includes(req.method))res.once('finish',()=>{if(res.statusCode>=200&&res.statusCode<300)void refreshInfo(req).catch(error=>console.error('Creator information refresh:',error.code||error.name));});next();});
  installAuth(app, sql);
  const reviews = mongo.collection('resenas');
  const select = 'SELECT p.*, c.nombre AS categoria FROM productos p JOIN categorias c ON c.id = p.categoria_id';
  app.param('id', (req, res, next, value) => {
    req.recordId = id(value);
    if (!req.recordId) return res.status(400).json({ error: 'Invalid identifier.' });
    next();
  });
  app.get('/api/health', async (req, res) => {
    await sql.query('SELECT 1');
    await mongo.command({ ping: 1 });
    res.json({ status: 'ok', mysql: 'connected', mongodb: 'connected' });
  });
  installCatalogCategories(app,sql);
  installAdminFoundation(app,sql);
  installAdminGovernance(app,sql,mongo);
  installAccountSettings(app,sql,requireUser);
  installAccountMutations(app,sql,requireUser);
  installSecurity(app,sql,requireUser);
  installBlocking(app,sql,requireUser);
  installAccountActivity(app,sql,mongo,requireUser);
  installActiveSessions(app,sql,requireUser);
  installProfiles(app,sql,options.profiles);
  installSocialLists(app,sql);
  installCreatorDiscovery(app,sql);installFollowingFeed(app,sql);
  installConversationPosts(app,sql,requireUser,{...options.conversations,mongo});
  installConversationEngagement(app,sql,requireUser,options.conversations);
  installConversationModeration(app,sql,requireUser);
  installSocialAccounts(app,sql,requireUser);
  installCreatorVerification(app,sql,requireUser,options.verification);
  installProducts(app,sql,mongo);
  installFavorites(app,sql);
  installCreatorStudio(app,sql);installSalesInsights(app,sql);
  installStorageQuotas(app,sql);
  installShoppingBag(app,sql);installCheckout(app,sql);installOrderDownloads(app,sql);installMyCollection(app,sql);installTemporaryLifecycle(app,sql,requireUser,mongo);
  installReviews(app,sql,mongo);
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if(res.headersSent)return next(error);
    if(error.status && error.message && !error.type) return res.status(error.status).json({error:error.message});
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Category does not exist.' });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'The record has related data.' });
    console.error('API error:', error.code || error.name);
    res.status(500).json({ error: 'Could not complete the operation. Check the databases.' });
  });
  return app;
}
