import {emailAuth} from '../lib/email-auth.js';
export const onRequestPost = context => emailAuth(context,true);
