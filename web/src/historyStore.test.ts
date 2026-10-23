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
