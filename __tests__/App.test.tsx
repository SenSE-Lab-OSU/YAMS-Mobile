/**
 * @format
 */

import React from 'react';
import { Modal, Switch } from 'react-native';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import App from '../App';

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
  expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(false);
  expect(findByLabel(tree, 'Settings')).toBeDefined();
});

test('the menu button opens the settings sheet', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    findByLabel(tree, 'Settings').props.onPress();
  });

  expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(true);
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
