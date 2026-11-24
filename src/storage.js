// Storage facade. Filesystem by default (local server, tests); Supabase when
// PIXELBOARD_SUPABASE_URL is set (the Vercel deploy — its filesystem is ephemeral).

import * as fsStore from './storage_fs.js';
import * as sbStore from './storage_supabase.js';

export const backend = process.env.PIXELBOARD_SUPABASE_URL ? 'supabase' : 'fs';
const s = backend === 'supabase' ? sbStore : fsStore;

export const {
  createSite, listSites, getSite, saveContent, saveBoard, getBoard, saveArtifact,
  saveAsset, readAsset, listBoards, listVersions, getVersion, savePublish,
  listSnapshots, readSnapshot, setClientAuth, getClientAuth, clearClientAuth,
  siteExists, isProtected, latestSnapshot, savePublishImage, readPublishImage,
} = s;
