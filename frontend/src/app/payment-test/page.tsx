'use client'

// Hidden Cashfree payment test page. Not linked from any navigation —
// open /payment-test directly. Sign-in is required (the backend creates
// orders under the signed-in user).
//
// Flow: backend creates the order -> Cashfree JS checkout opens as a modal ->
// backend re-fetches the order from Cashfree to confirm the real status.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError'
import { useAuthStore } from '@/store/useAuthStore'
import { openCashfreeCheckout } from '@/lib/cashfree'

interface OrderStatus {
  orderId: string
  orderStatus: string
  orderAmount: number
  orderCurrency: string
  payments: { cfPaymentId: string; status: string; amount: number; method: string; message: string; time: string }[]
}

export default function PaymentTestPage() {
  const email = useAuthStore((s) => s.email)
  const [amount, setAmount] = useState('1')
  const [name, setName] = useState('Test User')
  const [phone, setPhone] = useState('9999999999')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<OrderStatus | null>(null)

  const addLog = (line: string) =>
    setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${line}`])

  const verify = async (orderId: string) => {
    addLog(`Verifying order ${orderId} with Cashfree…`)
    const res = await apiFetch(`/api/payments/cashfree/order/${encodeURIComponent(orderId)}`)
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'check the order status'))
    const data = await res.json()
    setStatus(data)
    addLog(`Order status: ${data.orderStatus}`)
  }

  // Coming back from a redirect-based payment method (?order_id=...).
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('order_id')
    if (orderId) verify(orderId).catch((e) => setError(caughtErrorMessage(e, 'check the order status')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pay = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      addLog(`Creating order for ₹${amount}…`)
      const res = await apiFetch('/api/payments/cashfree/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          returnUrl: `${window.location.origin}/payment-test`,
        }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'create the order'))
      const order = await res.json()
      addLog(`Order ${order.orderId} created (${order.environment})`)

      addLog('Opening Cashfree checkout…')
      const result = await openCashfreeCheckout(order)

      if (result.closedMessage) addLog(`Checkout closed: ${result.closedMessage}`)
      else if (result.redirected) addLog('Redirecting for payment…')
      else if (result.paymentMessage) addLog(`Checkout: ${result.paymentMessage}`)

      if (!result.redirected) await verify(order.orderId)
    } catch (e) {
      const msg = caughtErrorMessage(e, 'complete the payment')
      setError(msg)
      addLog(`Error: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const statusColor =
    status?.orderStatus === 'PAID' ? 'text-green-700 bg-green-50'
    : status?.orderStatus === 'ACTIVE' ? 'text-amber-700 bg-amber-50'
    : 'text-red-700 bg-red-50'

  return (
    <div className="min-h-screen bg-[#f6f8f6] px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Cashfree payment test</h1>
          <p className="mt-1 text-sm text-gray-500">
            Internal test page. In sandbox, use Cashfree&apos;s test cards/UPI — no real money moves.
          </p>
        </div>

        <div className="space-y-4 rounded-xl border bg-white p-5">
          <label className="block text-sm">
            <span className="text-gray-600">Amount (₹)</span>
            <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">Phone (10 digits)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
          <p className="text-xs text-gray-500">Email: {email || '—'}</p>
          <button onClick={pay} disabled={busy}
            className="w-full rounded-md bg-black py-2.5 font-medium text-white disabled:opacity-50">
            {busy ? 'Processing…' : `Pay ₹${amount || 0}`}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {status && (
          <div className="space-y-3 rounded-xl border bg-white p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">{status.orderId}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusColor}`}>{status.orderStatus}</span>
            </div>
            <p>{status.orderCurrency} {status.orderAmount}</p>
            {status.payments.map((p) => (
              <div key={p.cfPaymentId} className="rounded border p-2 text-xs">
                <div>{p.status} · {p.method} · ₹{p.amount}</div>
                <div className="text-gray-500">{p.message}</div>
              </div>
            ))}
            <button onClick={() => verify(status.orderId).catch((e) => setError(caughtErrorMessage(e, 'check the order status')))}
              className="text-xs underline">Refresh status</button>
          </div>
        )}

        {log.length > 0 && (
          <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs text-gray-100">{log.join('\n')}</pre>
        )}
      </div>
    </div>
  )
}
