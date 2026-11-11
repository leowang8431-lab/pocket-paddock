import { GamepadInput } from './gamepad';
import type { Language } from './i18n';

interface GamepadMenu {
  menu: HTMLElement;
  travel: HTMLElement;
  status: HTMLElement;
  isPlaying: () => boolean;
  getLanguage: () => Language;
}

type MenuControl = HTMLButtonElement | HTMLSelectElement;

const menuRows = [
  '.rc-header-actions button',
  '#rc-driver',
  '[data-view]',
  '#rc-circuit',
  '#rc-team',
  '#rc-mode',
  '#rc-tyres',
  '#rc-launch',
];

function controlRows(menu: HTMLElement): MenuControl[][] {
  return menuRows.map(selector => [...menu.querySelectorAll<MenuControl>(selector)]
    .filter(control => !control.disabled && !control.hidden));
}

export function installRaceControlGamepad({ menu, travel, status, isPlaying, getLanguage }: GamepadMenu): void {
  let focusedByPad: HTMLElement | undefined;
  let timer: number | undefined;
  let lastHint = '';
  const travelHint = document.createElement('p');
  travelHint.className = 'rc-travel-pad-hint';
  travelHint.hidden = true;
  travel.querySelector('.travel-choices')?.after(travelHint);

  function clearGamepadFocus() {
    focusedByPad?.classList.remove('rc-gamepad-focus');
    focusedByPad = undefined;
  }

  function markFocus(control: HTMLElement) {
    if (focusedByPad === control) return;
    clearGamepadFocus();
    control.classList.add('rc-gamepad-focus');
    focusedByPad = control;
  }

  function focus(control: HTMLElement) {
    control.focus();
    if (document.activeElement === control) markFocus(control);
  }

  function move<T>(items: readonly T[], current: T, offset: number): T {
    return items[(items.indexOf(current) + offset + items.length) % items.length];
  }

  function stepSelect(select: HTMLSelectElement, offset: number) {
    const choices = [...select.options].filter(option => !option.disabled);
    const current = choices.find(option => option.selected);
    if (!current || choices.length < 2) return;
    select.value = move(choices, current, offset).value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function action(code: string) {
    if (isPlaying() || document.hidden || !document.hasFocus()) return;
    const confirm = code === 'GamepadConfirm';
    const horizontal = code === 'GamepadLeft' || code === 'GamepadRight';
    const vertical = code === 'GamepadUp' || code === 'GamepadDown';
    if (!confirm && !horizontal && !vertical) return;
    const direction = code === 'GamepadLeft' || code === 'GamepadUp' ? -1 : 1;
    const active = document.activeElement;
    if (!travel.hidden) {
      if (travel.dataset.travelPhase !== 'choose') return;
      const choices = [...travel.querySelectorAll<HTMLButtonElement>('button[data-travel-circuit]:enabled')];
      if (!choices.length) return;
      const current = choices.find(choice => choice === active) ?? choices[0];
      if (confirm) {
        focus(current);
        current.click();
      } else focus(move(choices, current, direction));
      return;
    }
    if (menu.inert) return;
    const rows = controlRows(menu).filter(row => row.length > 0);
    const row = rows.find(controls => controls.some(control => control === active));
    const current = row?.find(control => control === active);
    if (!row || !current) {
      const first = menu.querySelector<HTMLSelectElement>('#rc-circuit') ?? rows[0]?.[0];
      if (first) focus(first);
      return;
    }
    markFocus(current);
    if (vertical) {
      const next = move(rows, row, direction);
      focus(next.find(control => control.getAttribute('aria-pressed') === 'true') ?? next[0]);
    } else if (horizontal) {
      if (current instanceof HTMLSelectElement) stepSelect(current, direction);
      else if (row.length > 1) focus(move(row, current, direction));
    } else if (current instanceof HTMLButtonElement) current.click();
  }

  const pad = new GamepadInput(action);

  function updateHint() {
    const zh = getLanguage() === 'zh';
    const hint = !pad.summary.connected ? '' : pad.summary.supported
      ? zh ? '手柄已连接 · ↑↓ 选择 · ←→ 调整 · A/× 确认' : 'Controller connected · ↑↓ Select · ←→ Change · A/× Confirm'
      : zh ? '此手柄布局暂不支持' : 'This controller layout is not supported';
    if (hint !== lastHint) {
      lastHint = hint;
      status.textContent = hint;
      status.hidden = !hint;
    }
    const choosing = !travel.hidden && travel.dataset.travelPhase === 'choose';
    const intro = choosing && hint
      ? pad.summary.supported
        ? zh ? '手柄：←→ 选择赛道 · A/× 确认' : 'Controller: ←→ Choose circuit · A/× Confirm'
        : hint
      : '';
    if (travelHint.textContent !== intro) travelHint.textContent = intro;
    if (travelHint.hidden !== !intro) travelHint.hidden = !intro;
  }

  function poll() {
    timer = undefined;
    if (document.hidden) return;
    if (isPlaying() || !document.hasFocus()) pad.suspend();
    else {
      try {
        if (typeof navigator.getGamepads === 'function') pad.poll(Array.from(navigator.getGamepads()));
        else pad.poll([], false);
      } catch { pad.poll([], false); }
      updateHint();
    }
    timer = window.setTimeout(poll, isPlaying() ? 120 : 33);
  }

  document.addEventListener('pointerdown', clearGamepadFocus, true);
  document.addEventListener('keydown', clearGamepadFocus, true);
  document.addEventListener('visibilitychange', () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    pad.suspend();
    if (!document.hidden) poll();
  });
  poll();
}
