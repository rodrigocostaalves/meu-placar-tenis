import {deletionEmail} from '../lib/deletion-email.js';
export const onRequestPost = context => deletionEmail(context,false);
