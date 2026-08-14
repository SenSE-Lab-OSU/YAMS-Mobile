/**
 * @format
 */

import React from 'react';
import { Modal, Switch } from 'react-native';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import App from '../App';
import { Onboarding } from '../src/storage/Onboarding';

jest.mock('../src/storage/Onboarding', () => ({
  Onboarding: { hasCompleted: jest.fn(async () => true), markCompleted: jest.fn(async () => {}) },
}));

const onboarding = Onboarding as jest.Mocked<typeof Onboarding>;

beforeEach(() => {
  onboarding.hasCompleted.mockResolvedValue(true);
  onboarding.markCompleted.mockClear();
});

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  return tree;
}

/**
 * All text rendered anywhere in the tree. Walks the JSON output rather than
 * findAllByType(Text), which does not flatten children split across nested nodes.
 */
function renderedText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return parts.join(' ');
}

function findByLabel(tree: ReactTestRenderer.ReactTestRenderer, label: string): ReactTestInstance {
  return tree.root.findAll(
    node => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
  )[0];
}

/**
 * Indexing findAllByType(Modal) is ambiguous now that the tour is a modal too, and
 * a hidden Modal renders no children to search, so both carry a testID.
 */
function modalById(tree: ReactTestRenderer.ReactTestRenderer, testID: string): ReactTestInstance {
  return tree.root.findAllByType(Modal).filter(modal => modal.props.testID === testID)[0];
}

const settingsModal = (tree: ReactTestRenderer.ReactTestRenderer) =>
  modalById(tree, 'settings-sheet');

function findByText(tree: ReactTestRenderer.ReactTestRenderer, title: string): ReactTestInstance {
  return tree.root.findAll(
    node => node.props?.title === title && typeof node.props?.onPress === 'function',
  )[0];
}

/** The settings sheet's switches, in render order: keep awake, then simulated device. */
function switches(tree: ReactTestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAllByType(Switch);
}

test('renders correctly', async () => {
  await render();
});

test('settings live behind the menu button, not on the main screen', async () => {
  const tree = await render();

  // The sheet is mounted but not visible, so its switches must not be reachable
  // from the main screen without opening it.
  expect(settingsModal(tree).props.visible).toBe(false);
  expect(findByLabel(tree, 'Settings')).toBeDefined();
});

test('the menu button opens the settings sheet', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    findByLabel(tree, 'Settings').props.onPress();
  });

  expect(settingsModal(tree).props.visible).toBe(true);
});

test('turning demo mode on shows the banner immediately, before any device connects', async () => {
  const tree = await render();

  expect(renderedText(tree)).not.toContain('Demo mode is on.');

  await ReactTestRenderer.act(() => {
    findByLabel(tree, 'Settings').props.onPress();
  });
  await ReactTestRenderer.act(() => {
    // Second switch is Simulated device.
    switches(tree)[1].props.onValueChange(true);
  });

  const text = renderedText(tree);
  expect(text).toContain('Demo mode is on.');
  // Nothing is connected yet, so it must not claim to be recording.
  expect(text).toContain('A simulated wristband appears in scan results');
  expect(text).not.toContain('This session records synthetic data');
});

test('the empty state points at the menu so demo mode can be found without hardware', async () => {
  const tree = await render();
  const text = renderedText(tree);

  expect(text).toContain('No devices connected yet.');
  expect(text).toContain('☰');
  expect(text).toContain('Simulated device');
});

describe('first-launch tour', () => {
  it('is not shown once the flag is set', async () => {
    const tree = await render();
    const modals = tree.root.findAllByType(Modal);
    expect(modals.some(modal => modal.props.visible)).toBe(false);
  });

  it('is shown when the flag is absent', async () => {
    onboarding.hasCompleted.mockResolvedValue(false);
    const tree = await render();

    const text = renderedText(tree);
    expect(text).toContain('Collect from MotionSenSE wristbands');
    // The wording constraints that made this screen worth writing.
    expect(text).toContain('timing signal');
    expect(text).toContain('lined up in time');
    expect(text).not.toContain('ENMO');
    expect(text).not.toContain('beacon');
    expect(text).toContain('no network connections');
  });

  it('records completion so it does not reappear', async () => {
    onboarding.hasCompleted.mockResolvedValue(false);
    const tree = await render();

    // Walk to the last pane, then finish.
    for (const label of ['Next', 'Next', 'Continue']) {
      await ReactTestRenderer.act(() => {
        findByText(tree, label).props.onPress();
      });
    }

    expect(onboarding.markCompleted).toHaveBeenCalled();
    expect(renderedText(tree)).toContain('No devices connected yet.');
  });

  it('names the menu and switch the main screen actually uses', async () => {
    onboarding.hasCompleted.mockResolvedValue(false);
    const tree = await render();

    await ReactTestRenderer.act(() => {
      findByText(tree, 'Next').props.onPress();
    });

    const text = renderedText(tree);
    expect(text).toContain('☰');
    expect(text).toContain('Simulated device');
  });
});
