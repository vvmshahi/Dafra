import assert from 'node:assert/strict'
import {
  resolveBranchDisplayName,
  resolveBusinessDisplayName,
} from '../src/lib/utils/localizedDisplayName.mjs'

assert.equal(
  resolveBranchDisplayName({ name_ar: null, name: 'تسالي تورتيلا' }, true),
  'تسالي تورتيلا',
  'Arabic branch display falls back from missing name_ar to name',
)

assert.equal(
  resolveBranchDisplayName({ name: null, name_ar: 'الفرع العربي' }, false),
  'الفرع العربي',
  'English branch display falls back from missing name to name_ar',
)

assert.equal(
  resolveBranchDisplayName({ name_ar: '   ', name: 'Fallback branch' }, true),
  'Fallback branch',
  'Whitespace-only localized branch values are missing',
)

assert.equal(
  resolveBranchDisplayName({}, true),
  '?',
  'The final placeholder remains when every branch candidate is missing',
)

assert.equal(
  resolveBusinessDisplayName(
    { business_name_ar: null, business_name: 'مؤسسة ساميه مقعد البقمي التجارية' },
    true,
  ),
  'مؤسسة ساميه مقعد البقمي التجارية',
  'Arabic company display falls back to business_name',
)

assert.equal(
  resolveBranchDisplayName({ name: null, branch_name: 'API branch', branchName: 'Session branch' }, false),
  'API branch',
  'Branch API aliases follow the required order',
)

assert.equal(
  resolveBranchDisplayName({ name_ar: 'الاسم المحلي', name: 'Base name' }, true),
  'الاسم المحلي',
  'An existing Arabic localized branch name remains preferred',
)

assert.equal(
  resolveBusinessDisplayName(
    { business_name: 'English business', business_name_ar: 'النشاط العربي' },
    false,
  ),
  'English business',
  'An existing English business name remains preferred',
)

console.log('localized display-name fallback tests passed')
