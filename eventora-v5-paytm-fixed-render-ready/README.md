# Eventora V5 — Razorpay + Paytm

Eventora V5 adds Paytm Payment Gateway as a selectable payment option alongside Razorpay.

## Paytm flow
1. Server creates a pending booking.
2. Server calls Paytm Initiate Transaction API.
3. Frontend opens Paytm JS Checkout using the returned transaction token.
4. Paytm posts the callback to Eventora.
5. Eventora verifies the Paytm checksum.
6. Eventora performs a server-to-server Paytm order-status verification.
7. Only `TXN_SUCCESS` bookings are confirmed and receive QR tickets.

## Render
See `PAYTM-SETUP.txt`.

## Required Paytm variables
- `PAYTM_MID`
- `PAYTM_MERCHANT_KEY`
- `PAYTM_WEBSITE`
- `PAYTM_ENV`

Use staging before production.
