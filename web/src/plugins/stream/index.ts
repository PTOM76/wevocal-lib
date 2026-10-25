// Worker から使う入口（画面とプラグインの一覧を読まない）。processor をシムで回す仕組みと、つまみの値の計算
export * from './processorShim'
export { autoValueAt } from '../autoValue'
export { clampParam, SMOOTH } from '../../../../plugin-sdk/FxBase'
