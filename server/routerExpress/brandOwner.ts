// Express route for the brand-owner magic-link exchange. Just one endpoint:
// the merchant taps a link → frontend posts the token here → we return a JWT
// the frontend stores in the same place the rest of the app stores its token.

import { Router } from 'express';
import { consumeMagicLink } from '../lib/brandOwnerAuth';

const router = Router();

// POST /api/owner/auth/exchange { token } → { jwt, tagId, accountId }
router.post('/auth/exchange', async (req, res) => {
  const raw = String(req.body?.token ?? '');
  const result = await consumeMagicLink(raw);
  if (!result.ok) {
    const httpCode = result.reason === 'expired' || result.reason === 'used' ? 410 : 400;
    return res.status(httpCode).json({ error: result.reason });
  }
  return res.json({ jwt: result.jwt, tagId: result.tagId, accountId: result.accountId });
});

export default router;
