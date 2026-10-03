import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CLEAR_ALL_ORDERS_SQL } from './dataAdminTemplates'

describe('clear all orders SQL template', () => {
  it('deletes dependent order rows before orders and preserves configuration tables', () => {
    assert.ok(CLEAR_ALL_ORDERS_SQL.indexOf('DELETE FROM order_action_states') < CLEAR_ALL_ORDERS_SQL.indexOf('DELETE FROM operation_orders'))
    assert.ok(CLEAR_ALL_ORDERS_SQL.indexOf('DELETE FROM order_events') < CLEAR_ALL_ORDERS_SQL.indexOf('DELETE FROM operation_orders'))
    assert.doesNotMatch(CLEAR_ALL_ORDERS_SQL, /TRUNCATE|CASCADE|vehicles|operation_routes|time_templates/i)
    assert.match(CLEAR_ALL_ORDERS_SQL, /deleted_orders/)
  })
})
