// history.ts のテスト
import { describe, expect, it } from 'vitest'
import { commitHistory, gotoHistory, historySteps, newHistory, redoHistory, undoHistory } from './history'

const make = (...xs: number[]) => xs.slice(1).reduce((h, x) => commitHistory(h, x, 100), newHistory(xs[0]))

describe('history', () => {
  it('commit は今を過去に積み、未来を捨てる', () => {
    const h = commitHistory(undoHistory(make(1, 2, 3)), 9, 100)
    expect(h).toEqual({ past: [1, 2], present: 9, future: [] })
  })

  it('merged なら過去に積まず、今だけを置き換える', () => {
    const h = commitHistory(make(1, 2), 3, 100, true)
    expect(h).toEqual({ past: [1], present: 3, future: [] })
  })

  it('limit を超えた古い段を捨てる', () => {
    const h = [2, 3, 4, 5].reduce((x, v) => commitHistory(x, v, 2), newHistory(1))
    expect(h).toEqual({ past: [3, 4], present: 5, future: [] })
  })

  it('undo と redo は行き来できて、端では何も変えない', () => {
    const h = make(1, 2, 3)
    expect(undoHistory(undoHistory(h))).toEqual({ past: [], present: 1, future: [2, 3] })
    const start = undoHistory(undoHistory(h))
    expect(undoHistory(start)).toBe(start)
    expect(redoHistory(redoHistory(start))).toEqual(h)
    expect(redoHistory(h)).toBe(h)
  })

  it('goto は index 番目へ行き、範囲の外は動かさない', () => {
    const h = make(1, 2, 3, 4)
    expect(gotoHistory(h, 1)).toEqual({ past: [1], present: 2, future: [3, 4] })
    expect(gotoHistory(h, 3)).toEqual(h)
    expect(gotoHistory(h, -1)).toBe(h)
    expect(gotoHistory(h, 4)).toBe(h)
    expect(historySteps(gotoHistory(h, 0))).toEqual([1, 2, 3, 4])
  })
})
