// historyStore.ts のテスト
import { describe, expect, it, vi } from 'vitest'
import { createHistoryStore } from './historyStore'

const make = (limit = 100) => createHistoryStore(0, () => limit)

describe('commit', () => {
  it('積んで、同じ値なら何もせず通知もしない', () => {
    const s = make()
    const l = vi.fn()
    s.subscribe(l)
    s.commit((n) => n + 1)
    s.commit((n) => n)
    expect(s.get()).toEqual({ past: [0], present: 1, future: [] })
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('merge が続くあいだは 1 段にまとめ、endMerge で切る', () => {
    const s = make()
    s.commit((n) => n + 1, 'drag')
    s.commit((n) => n + 1, 'drag')
    s.commit((n) => n + 1, 'drag')
    expect(s.get().past).toEqual([0])
    s.endMerge()
    s.commit((n) => n + 1, 'drag')
    expect(s.get().past).toEqual([0, 3])
    s.commit((n) => n + 1, 'other')
    expect(s.get().past).toEqual([0, 3, 4])
  })

  it('update にまとめるかどうかを渡す', () => {
    const s = make()
    const seen: boolean[] = []
    const up = (n: number, merged: boolean) => (seen.push(merged), n + 1)
    s.commit(up, 'k')
    s.commit(up, 'k')
    s.endMerge()
    s.commit(up, 'k')
    expect(seen).toEqual([false, true, false])
  })

  it('limit を超えた古い段を捨てる', () => {
    const s = make(2)
    for (let i = 0; i < 5; i++) s.commit((n) => n + 1)
    expect(s.get().past).toEqual([3, 4])
  })
})

describe('undo、redo、goto、reset', () => {
  it('行き来でき、変更のあとは未来が消える', () => {
    const s = make()
    s.commit((n) => n + 1)
    s.commit((n) => n + 1)
    s.undo()
    expect(s.get().present).toBe(1)
    s.redo()
    expect(s.get().present).toBe(2)
    s.goto(0)
    expect(s.get().present).toBe(0)
    s.commit((n) => n + 10)
    expect(s.get()).toEqual({ past: [0], present: 10, future: [] })
    s.reset(7)
    expect(s.get()).toEqual({ past: [], present: 7, future: [] })
  })

  it('undo のあとの同じ merge は、前の続きにしない', () => {
    const s = make()
    s.commit((n) => n + 1, 'k')
    s.undo()
    s.commit((n) => n + 1, 'k')
    expect(s.get().past).toEqual([0])
    s.undo()
    expect(s.get().present).toBe(0)
  })
})

describe('restore', () => {
  it('履歴ごと入れ替える（段も、未来も戻る）。続けての変更のまとまりは切れる', () => {
    const a = make()
    a.commit((n) => n + 1)
    a.commit((n) => n + 1, 'k')
    const saved = a.get()
    a.reset(100)
    a.restore(saved)
    expect(a.get()).toBe(saved)
    a.commit((n) => n + 1, 'k')
    expect(a.get().past).toEqual([0, 1, 2])
    a.undo()
    expect(a.get().present).toBe(2)
  })
})

describe('cancelMerge', () => {
  it('続けた変更をまとめて取り消し、前にあった未来も戻る', () => {
    const s = make()
    s.commit((n) => n + 1)
    s.commit((n) => n + 1)
    s.undo()
    const before = s.get()
    s.commit((n) => n + 10, 'drag')
    s.commit((n) => n + 10, 'drag')
    expect(s.cancelMerge('drag')).toBe(true)
    expect(s.get()).toBe(before)
  })

  it('1 度も変えていない merge や、別のキー、終わった merge は取り消さない', () => {
    const s = make()
    s.commit((n) => n + 1)
    s.commit((n) => n, 'drag')
    expect(s.cancelMerge('drag')).toBe(false)
    s.commit((n) => n + 1, 'other')
    expect(s.cancelMerge('drag')).toBe(false)
    s.endMerge()
    expect(s.cancelMerge('other')).toBe(false)
    expect(s.get().present).toBe(2)
  })

  it('始めの変更が空振りでも、あとの変更は取り消せる', () => {
    const s = make()
    s.commit((n) => n + 1)
    s.commit((n) => n, 'drag')
    s.commit((n) => n + 5, 'drag')
    expect(s.cancelMerge('drag')).toBe(true)
    expect(s.get().present).toBe(1)
  })
})

describe('replacePresent', () => {
  it('履歴に積まずに今を変える', () => {
    const s = make()
    s.commit((n) => n + 1)
    s.replacePresent((n) => n + 100)
    expect(s.get()).toEqual({ past: [0], present: 101, future: [] })
  })
})

describe('トランザクション', () => {
  it('途中経過は 1 段のまま積まれ、commit で確定する', () => {
    const s = make()
    s.commit((n) => n + 1)
    const tx = s.begin()
    tx.update((n) => n + 1)
    tx.update((n) => n + 1)
    expect(s.get()).toEqual({ past: [0, 1], present: 3, future: [] })
    tx.commit()
    s.undo()
    expect(s.get().present).toBe(1)
  })

  it('cancel で始める前に戻り、履歴も増えない', () => {
    const s = make()
    s.commit((n) => n + 1)
    const before = s.get()
    const tx = s.begin()
    tx.update((n) => n + 5)
    tx.cancel()
    expect(s.get()).toBe(before)
  })

  it('終わったトランザクションは何もしない', () => {
    const s = make()
    const tx = s.begin()
    tx.update((n) => n + 1)
    tx.commit()
    tx.update((n) => n + 1)
    tx.cancel()
    expect(s.get().present).toBe(1)
  })
})

describe('subscribe', () => {
  it('外すと通知されない', () => {
    const s = make()
    const l = vi.fn()
    const off = s.subscribe(l)
    s.commit((n) => n + 1)
    off()
    s.commit((n) => n + 1)
    expect(l).toHaveBeenCalledTimes(1)
  })
})
