import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import i18n from '@/localization/i18n'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import { ReportTabs, type TabId } from '@/pages/reports/ReportsPage'
import { archiveEntity, type ArchiveEntityResponse } from '@/lib/archiveEntity'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function key(target: Element, value: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))
}

async function mount(element: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  await act(async () => { root.render(element) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return {
    host,
    async unmount() {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

async function testConfirmDialog() {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  let closes = 0
  let confirms = 0
  const view = await mount(
    <ConfirmDialog open kind="archive" name="Coffee" onClose={() => { closes++ }} onConfirm={() => { confirms++ }} />,
  )
  const dialog = view.host.querySelector<HTMLElement>('[role="alertdialog"]')
  const buttons = [...view.host.querySelectorAll<HTMLButtonElement>('button')]
  assert(dialog?.getAttribute('aria-modal') === 'true', 'confirmation dialog must be modal')
  assert(dialog.getAttribute('aria-labelledby') && dialog.getAttribute('aria-describedby'), 'dialog must have accessible title and body')
  assert(document.body.style.overflow === 'hidden', 'dialog must lock body scrolling')
  assert(document.activeElement === buttons[0], 'dialog must focus its cancel action on open')

  buttons[1].focus()
  await act(async () => key(dialog, 'Tab'))
  assert(document.activeElement === buttons[0], 'Tab must wrap from last to first action')
  await act(async () => key(dialog, 'Tab', true))
  assert(document.activeElement === buttons[1], 'Shift+Tab must wrap from first to last action')
  await act(async () => key(dialog, 'Escape'))
  assert(closes === 1, 'Escape must request close')
  await act(async () => buttons[1].click())
  assert(confirms === 1, 'confirm action must fire once')
  await view.unmount()
  assert(document.body.style.overflow === '', 'dialog must restore body overflow')
  assert(document.activeElement === opener, 'dialog must restore focus to its opener')
  opener.remove()

  const busy = await mount(
    <ConfirmDialog open busy kind="archive" onClose={() => { closes++ }} onConfirm={() => { confirms++ }} />,
  )
  const busyDialog = busy.host.querySelector<HTMLElement>('[role="alertdialog"]')!
  const busyButtons = [...busy.host.querySelectorAll<HTMLButtonElement>('button')]
  assert(busyButtons.every(button => button.disabled), 'busy dialog actions must be disabled')
  await act(async () => key(busyDialog, 'Escape'))
  await act(async () => busyButtons[1].click())
  assert(closes === 1 && confirms === 1, 'busy dialog must suppress close and confirm actions')
  await busy.unmount()
}

async function testReportTabs() {
  function Fixture() {
    const [active, setActive] = useState<TabId>('sessions')
    return <ReportTabs active={active} onSelect={setActive} />
  }
  document.documentElement.dir = 'ltr'
  const view = await mount(<Fixture />)
  const tabs = [...view.host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  assert(tabs.length === 7, 'report tablist must expose all report tabs')
  tabs[0].focus()
  await act(async () => key(tabs[0], 'ArrowRight'))
  assert(document.activeElement === tabs[1] && tabs[1].getAttribute('aria-selected') === 'true', 'LTR ArrowRight must select and focus next tab')
  await act(async () => key(tabs[1], 'End'))
  assert(document.activeElement === tabs.at(-1), 'End must focus the last tab')
  await act(async () => key(tabs.at(-1)!, 'Home'))
  assert(document.activeElement === tabs[0], 'Home must focus the first tab')
  document.documentElement.dir = 'rtl'
  await act(async () => key(tabs[0], 'ArrowRight'))
  assert(document.activeElement === tabs.at(-1), 'RTL ArrowRight must follow visual direction and wrap')
  await view.unmount()
}

async function testLanguageSwitch() {
  await i18n.changeLanguage('en')
  const view = await mount(<AuthenticatedLanguageSwitch />)
  const button = view.host.querySelector<HTMLButtonElement>('button')!
  button.focus()
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  assert(document.documentElement.lang === 'ar-SA', 'language switch must update document language')
  assert(document.documentElement.dir === 'rtl', 'language switch must update document direction')
  assert(document.activeElement === button, 'language switch must retain keyboard focus')
  assert(button.lang === 'en' && button.dir === 'ltr', 'switch affordance must describe the target locale')
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  assert(document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr', 'language switch must restore English LTR state')
  await view.unmount()
}

async function testVerifiedArchiveResponses() {
  function clientFor(response: ArchiveEntityResponse) {
    let requests = 0
    return {
      get requests() { return requests },
      client: {
        from: () => ({
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  requests++
                  return response
                },
              }),
            }),
          }),
        }),
      },
    }
  }

  const success = clientFor({ data: { id: 'customer-1' }, error: null, status: 200 })
  await archiveEntity(success.client, 'customers', 'customer-1')
  assert(success.requests === 1, 'verified archive success must issue one request')
  for (const response of [
    { data: null, error: new Error('network'), status: 500 },
    { data: null, error: null, status: 204 },
    { data: { id: 'wrong-id' }, error: null, status: 200 },
    { data: { id: 'supplier-1' }, error: null, status: 409 },
  ]) {
    const failure = clientFor(response)
    let rejected = false
    try {
      await archiveEntity(failure.client, 'suppliers', 'supplier-1')
    } catch {
      rejected = true
    }
    assert(rejected, 'archive must reject errors, empty results, ID mismatches, and non-2xx statuses')
  }
}

export async function run() {
  await testConfirmDialog()
  await testReportTabs()
  await testLanguageSwitch()
  await testVerifiedArchiveResponses()
  return [
    'confirmation dialog semantics, focus lifecycle, keyboard trap, busy suppression',
    'report tab selection, focus, Home/End, LTR and RTL arrow behavior',
    'authenticated language switch document lang/dir and focus retention',
    'customer/supplier archive exact-response success and false-success rejection',
  ]
}
