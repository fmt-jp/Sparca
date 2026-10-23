import { describe, expect, it } from 'vitest';
import { addObject } from '../model/commands';
import { createDocument, createShape, defaultGeometry } from '../model/factory';
import { EditorStore, UNTITLED } from './editor';

const shape = () => createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 });

describe('editor tabs', () => {
  it('replaces a pristine untitled document instead of opening a new tab', () => {
    const ed = new EditorStore();
    ed.openDocument(createDocument(100, 100), 'a');
    expect(ed.getState().tabs.map((t) => t.fileName)).toEqual(['a']);
  });

  it('keeps each document with its own history, selection and zoom', () => {
    const ed = new EditorStore();
    ed.openDocument(createDocument(100, 100), 'a');
    const s1 = shape();
    ed.edit('add', (d) => addObject(d, d.layers[0].id, s1));
    ed.select([s1.id]);
    ed.set({ zoom: 2 });
    const tabA = ed.getState().activeTabId;

    ed.openDocument(createDocument(300, 200), 'b');
    expect(ed.getState().tabs.map((t) => [t.fileName, t.dirty])).toEqual([['a', true], ['b', false]]);
    expect(ed.getState()).toMatchObject({ fileName: 'b', selection: [], zoom: 1 });
    expect(ed.getState().history.past).toHaveLength(0);
    ed.undo(); // nothing to undo in b
    expect(ed.getState().doc.width).toBe(300);

    ed.switchTab(tabA);
    expect(ed.getState()).toMatchObject({ fileName: 'a', selection: [s1.id], zoom: 2 });
    ed.undo();
    expect(ed.getState().doc.layers[0].children).toHaveLength(0);
    expect(ed.anyDirty).toBe(false);
  });

  it('closes tabs, activating a neighbor; the last tab becomes a new untitled document', () => {
    const ed = new EditorStore();
    ed.openDocument(createDocument(), 'a');
    ed.edit('x', (d) => addObject(d, d.layers[0].id, shape())); // a is no longer pristine
    ed.openDocument(createDocument(), 'b');
    ed.openDocument(createDocument(), 'c');
    const [a, b, c] = ed.getState().tabs.map((t) => t.id);
    ed.switchTab(b);
    ed.closeTab(b);
    expect(ed.getState().activeTabId).toBe(c);
    ed.closeTab(a);
    expect(ed.getState().tabs.map((t) => t.fileName)).toEqual(['c']);
    ed.closeTab(c);
    expect(ed.getState().tabs).toHaveLength(1);
    expect(ed.getState().fileName).toBe(UNTITLED);
  });

  it('tracks dirty state per tab and on save', () => {
    const ed = new EditorStore();
    ed.openDocument(createDocument(), 'a');
    ed.edit('x', (d) => addObject(d, d.layers[0].id, shape()));
    expect(ed.getState().tabs[0].dirty).toBe(true);
    ed.markSaved('a.hnb');
    expect(ed.getState().tabs[0]).toMatchObject({ fileName: 'a.hnb', dirty: false });
  });
});

describe('pixel selection edge', () => {
  it('applies the tools edge setting to new and current selections', () => {
    const ed = new EditorStore();
    ed.setPixelSelection({ kind: 'rect', x: 0, y: 0, width: 50, height: 50 });
    expect(ed.getState().pixelSelection).toEqual({ kind: 'rect', x: 0, y: 0, width: 50, height: 50 });
    ed.setSelectionEdge({ mode: 'feather', feather: 12 });
    expect(ed.getState().pixelSelection).toMatchObject({ feather: 12 });
    ed.setSelectionEdge({ mode: 'hard' });
    expect(ed.getState().pixelSelection).toMatchObject({ antialias: false });
    expect(ed.getState().pixelSelection!.feather).toBeUndefined();
    ed.setPixelSelection({ kind: 'ellipse', x: 0, y: 0, width: 5, height: 5 });
    expect(ed.getState().pixelSelection).toMatchObject({ kind: 'ellipse', antialias: false });
  });

  it('expands and contracts the selection, refusing to contract it away', async () => {
    const { growSelection, pixelSelectionBounds } = await import('./imageActions');
    const ed = new EditorStore();
    ed.setSelectionEdge({ mode: 'feather', feather: 4 });
    ed.setPixelSelection({ kind: 'rect', x: 10, y: 10, width: 40, height: 40 });
    expect(growSelection(ed, 10)).toBe(true);
    expect(growSelection(ed, -4)).toBe(true);
    expect(ed.getState().pixelSelection).toMatchObject({ grow: 6, feather: 4 });
    expect(pixelSelectionBounds(ed.getState().pixelSelection!)).toEqual({ x: 0, y: 0, width: 60, height: 60 });
    expect(growSelection(ed, -6)).toBe(true);
    expect(ed.getState().pixelSelection!.grow).toBeUndefined();
    expect(growSelection(ed, -30)).toBe(false);
    expect(ed.getState().notices.at(-1)?.kind).toBe('error');
    expect(ed.getState().pixelSelection!.grow).toBeUndefined();
  });
});
