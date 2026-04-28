# Enat Bank Payment Gateway — Frontend Integration Guide

## Base URL

```
http://<server-ip>:4001
```

> All requests and responses are JSON (`Content-Type: application/json`) unless noted.  
> The server runs on port **4001** by default.

---

## General Response Shape

Every endpoint returns a consistent top-level `status` field:

| `status` value | Meaning |
|---|---|
| `"Success"` | Operation completed |
| `"Error"` | Something went wrong — check `message` |
| `"AlreadyPaid"` | Order was already paid (airline confirm only) |

---

## 1. Airline Ticket Payment (`/airline`)

### Flow

```
1. POST /airline/validate   ← check order exists and get amount
2. POST /airline/confirm    ← debit account + confirm with FlyGate
```

---

### `POST /airline/validate`

Check that an order ID exists on FlyGate and retrieve its details before showing the payment screen.

**Request**
```json
{
  "orderid": "ABCDEF123"
}
```

**Success `200`**
```json
{
  "success": true,
  "data": {
    "orderId":      "ABCDEF123",
    "amount":       4500,
    "customerName": "Abebe Kebede",
    "pnr":          "ET1234",
    "currency":     "ETB"
  }
}
```

**Not found `404`**
```json
{
  "success": false,
  "message": "Order not found or expired"
}
```

---

### `POST /airline/confirm`

Execute the payment. Debits the customer account via CBS and confirms with FlyGate.

**Request**
```json
{
  "orderid":        "ABCDEF123",
  "beneficiaryAcno": "0011230708313001",
  "branchCode":     "001",
  "amount":         4500,
  "currency":       "ETB",
  "pnr":            "ET1234",
  "customerName":   "Abebe Kebede",
  "remark":         "Airline ticket payment"
}
```

| Field | Required | Notes |
|---|---|---|
| `orderid` | ✅ | From validate response |
| `beneficiaryAcno` | ✅ | Customer's debit account number |
| `branchCode` | ✅ | Customer's branch code |
| `amount` | optional | Falls back to amount stored during validate |
| `currency` | optional | Default `ETB` |
| `pnr` | optional | Falls back to value from validate |
| `customerName` | optional | Falls back to value from validate |
| `remark` | optional | Free text |

**Success `200`**
```json
{
  "status":    "Success",
  "message":   "Successfully transferred",
  "reference": "FCC20260428001"
}
```

**Already paid `409`**
```json
{
  "status":      "AlreadyPaid",
  "message":     "Order ABCDEF123 has already been paid",
  "reference":   "FCC20260428001",
  "paidAt":      "2026-04-28T08:01:05.000Z",
  "amount":      4500,
  "traceNumber": "TRC1745827200"
}
```

**Invalid order `404`**
```json
{
  "status":  "Error",
  "message": "Invalid orderId: ABCDEF123 — order not found or expired"
}
```

**CBS / payment error `400` or `500`**
```json
{
  "status":  "Error",
  "message": "Invalid GL or Account Number."
}
```

---

### `POST /airline/refund`

> Called by the airline system, not the customer UI. Requires Basic Auth.

**Headers**
```
Authorization: Basic <base64(email:password)>
```

**Request**
```json
{
  "shortCode":           "526341",
  "orderId":             "ABCDEF123",
  "firstName":           "Abebe",
  "lastName":            "Kebede",
  "amount":              4500,
  "currency":            "ETB",
  "ReferenceNumber":     "FCC20260428001",
  "refundFOP":           "CASH",
  "refundReferenceCode": "RFND-ET1234-001"
}
```

**Success `200`**
```json
{
  "ResponseCode": 1,
  "success": "Success",
  "ResponseCodeDescription": "Successfully accepted Refund request"
}
```

---

## 2. Generic CBS Transfer (`/cbs`)

Use this for any payment channel — Telebirr, bill payment, M-Pesa, etc.

---

### `POST /cbs/transfer`

**Request**
```json
{
  "channel":     "TELEBIRR",
  "prd":         "TELE",
  "drAcNo":      "0011230708313001",
  "crAcNo":      "0461112216017001",
  "amount":      500,
  "drBranch":    "001",
  "crBranch":    "046",
  "currency":    "ETB",
  "narrative":   "Telebirr top-up",
  "referenceId": "0911234567"
}
```

| Field | Required | Notes |
|---|---|---|
| `channel` | ✅ | `TELEBIRR`, `AIRLINE`, `BILL`, `MPESA`, `OTHER` |
| `prd` | ✅ | CBS product code |
| `drAcNo` | ✅ | Debit account |
| `crAcNo` | ✅ | Credit account |
| `amount` | ✅ | Must be > 0 |
| `drBranch` | optional | Debit branch, defaults to server config |
| `crBranch` | optional | Credit branch, defaults to server config |
| `currency` | optional | Default `ETB` |
| `narrative` | optional | Transaction description |
| `referenceId` | optional | Your own reference (phone, bill no, PNR…) |

**Success `200`**
```json
{
  "status":      "Success",
  "message":     "CBS transaction completed successfully",
  "traceNumber": "TRC1745827200",
  "cbsRefNo":    "FCC20260428001",
  "auditId":     42
}
```

**Error `400`**
```json
{
  "status":    "Error",
  "message":   "Invalid GL or Account Number.",
  "errorCode": "DE-TUD-055",
  "traceNumber": "TRC1745827200",
  "auditId":   42
}
```

---

### `POST /cbs/reverse`

Reverse a previous CBS transaction.

**Request**
```json
{
  "cbsRefNo": "FCC20260428001"
}
```

**Success `200`**
```json
{
  "status":   "Success",
  "message":  "CBS reversal completed successfully",
  "cbsRefNo": "FCC20260428001"
}
```

---

### `GET /cbs/transfers`

Query the CBS transfer audit log.

**Query params**

| Param | Example | Notes |
|---|---|---|
| `channel` | `TELEBIRR` | Filter by channel |
| `referenceId` | `0911234567` | Partial match |
| `status` | `1` | `1`=success, `0`=failed |
| `from` | `2026-04-01` | ISO date |
| `to` | `2026-04-30` | ISO date |
| `page` | `1` | Default 1 |
| `limit` | `20` | Default 20 |

**Response `200`**
```json
{
  "status": "Success",
  "total":  150,
  "page":   1,
  "limit":  20,
  "data": [
    {
      "id":          42,
      "channel":     "TELEBIRR",
      "prd":         "TELE",
      "drAcNo":      "0011230708313001",
      "crAcNo":      "0461112216017001",
      "amount":      "500.00",
      "currency":    "ETB",
      "narrative":   "Telebirr top-up",
      "referenceId": "0911234567",
      "traceNumber": "TRC1745827200",
      "cbsRefNo":    "FCC20260428001",
      "status":      1,
      "entryTime":   "2026-04-28T08:01:05.000Z"
    }
  ]
}
```

---

## 3. Ride ET Bill Payment (`/ride`)

### Flow

```
1. POST /ride/query   ← verify phone is an active Ride account
2. POST /ride/pay     ← debit account via CBS + confirm to Ride
```

---

### `POST /ride/query`

Check if a phone number has an active Ride account before showing the payment form.

**Request**
```json
{
  "phone": "251911259134"
}
```

**Active account `200`**
```json
{
  "status":  "Success",
  "message": "Ride account is active",
  "data": {
    "full_name": "Ride Test 1",
    "phone":     "251911259134",
    "status":    "active"
  },
  "auditId": 7
}
```

**Not found `404`**
```json
{
  "status":  "Error",
  "message": "Phone number not found on Ride"
}
```

**Inactive `422`**
```json
{
  "status":  "Error",
  "message": "Ride account is not active (status: suspended)"
}
```

---

### `POST /ride/pay`

Full payment: verifies phone → debits CBS → confirms to Ride.

**Request**
```json
{
  "phone":     "251911259134",
  "amount":    300,
  "drAcNo":    "0011230708313001",
  "drBranch":  "001",
  "remark":    "Ride top-up",
  "billRefNo": "BR7654321"
}
```

| Field | Required | Notes |
|---|---|---|
| `phone` | ✅ | Ride account phone |
| `amount` | ✅ | Must be > 0 |
| `drAcNo` | ✅ | Customer debit account |
| `drBranch` | optional | Branch code |
| `remark` | optional | Free text |
| `billRefNo` | optional | Auto-generated if omitted |

**Success `200`**
```json
{
  "status":            "Success",
  "message":           "Ride payment completed successfully",
  "acknowledgementId": "52eb32d3-83ed-4579-8e15-fed0c9d38f8f",
  "cbsRefNo":          "FCC20260428005",
  "traceNumber":       "TRC1745831700",
  "billRefNo":         "BR7654321",
  "auditId":           12
}
```

**Phone not found `404`** / **Inactive `422`** / **CBS error `400`**
```json
{
  "status":  "Error",
  "message": "<reason>",
  "auditId": 12
}
```

---

### `GET /ride/transactions`

**Query params**

| Param | Example | Notes |
|---|---|---|
| `phone` | `251911` | Partial match |
| `paymentStatus` | `1` | `1`=success, `0`=failed |
| `cbsStatus` | `1` | `1`=success, `0`=failed |
| `from` | `2026-04-01` | ISO date |
| `to` | `2026-04-30` | ISO date |
| `page` | `1` | Default 1 |
| `limit` | `20` | Default 20 |

**Response `200`**
```json
{
  "status": "Success",
  "total":  50,
  "page":   1,
  "limit":  20,
  "data": [
    {
      "id":                1,
      "phone":             "251911259134",
      "fullName":          "Ride Test 1",
      "accountStatus":     "active",
      "amount":            "300.00",
      "billRefNo":         "BR7654321",
      "acknowledgementId": "52eb32d3-83ed-4579-8e15-fed0c9d38f8f",
      "cbsRefNo":          "FCC20260428005",
      "traceNumber":       "TRC1745831700",
      "queryStatus":       1,
      "paymentStatus":     1,
      "cbsStatus":         1,
      "entryTime":         "2026-04-28T09:15:00.000Z"
    }
  ]
}
```

---

## Error Handling Cheatsheet

| HTTP | `status` | What to show the user |
|---|---|---|
| `400` | `"Error"` | Show `message` — usually a validation or CBS error |
| `404` | `"Error"` | Order / phone not found |
| `409` | `"AlreadyPaid"` | "This order has already been paid" + show reference |
| `422` | `"Error"` | Account exists but is inactive |
| `500` | `"Error"` | Generic server error — show "Something went wrong, try again" |

---

## Suggested UI Flows

### Airline Ticket Payment

```
[Enter Order ID]
      ↓
POST /airline/validate
      ↓ success
[Show: customer name, amount, PNR]
[Enter: account number, branch]
      ↓
POST /airline/confirm
      ↓ 200  → "Payment successful — Ref: FCC..."
      ↓ 409  → "Already paid on <date>"
      ↓ 404  → "Invalid order ID"
      ↓ 400  → show message (CBS error)
```

### Ride Payment

```
[Enter phone number]
      ↓
POST /ride/query
      ↓ 200  → show full_name, enable Pay button
      ↓ 404  → "Phone not registered on Ride"
      ↓ 422  → "Account is not active"
[Enter: amount, account number]
      ↓
POST /ride/pay
      ↓ 200  → "Payment successful — Ack: 52eb32d3..."
      ↓ 400  → show message
```

### Generic CBS Transfer (Telebirr, Bill, etc.)

```
[Select channel, enter debit account, amount, reference]
      ↓
POST /cbs/transfer
      ↓ 200  → "Transfer successful — Ref: FCC..."
      ↓ 400  → show message + errorCode
```
