import dayjs from '@/lib/dayjs';

export type BouldHQTemplateKey = 'onboarding' | 'monthlyReview' | 'support' | 'internal';

const ONBOARDING_BODY = `**Onboarding Checklist**
- [ ] Store access confirmed
- [ ] Brand assets received (logo, colors, fonts)
- [ ] Shopify theme reviewed
- [ ] Apps audited
- [ ] Goals documented
- [ ] First sprint planned
`;

const monthlyReviewBody = (clientTag?: string) => `**Monthly Review**
**Month:** ${dayjs().format('MMMM YYYY')}
**Store:** ${clientTag ? `#${clientTag}` : '[Store Name]'}
**Revenue vs last month:**
**Top performing product:**
**Issues flagged:**
**Next actions:**
`;

const SUPPORT_BODY = `**Support Request**
**Issue:**
**Priority:** Low | Medium | High
**Steps to reproduce:**
**Expected:**
**Actual:**
`;

const INTERNAL_BODY = `**Internal Note**
`;

export function getTemplate(key: BouldHQTemplateKey, activeClientTag?: string): string {
  let body: string;
  switch (key) {
    case 'onboarding': body = ONBOARDING_BODY; break;
    case 'monthlyReview': body = monthlyReviewBody(activeClientTag); break;
    case 'support': body = SUPPORT_BODY; break;
    case 'internal': body = INTERNAL_BODY; break;
  }
  return activeClientTag ? `${body}\n#${activeClientTag}\n` : body;
}
