// Creates/cancels exactly one synthetic booking on a selected demo property.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
(async () => {
  const health = await fetch(`${base}/health`).then(r => r.json());
  assert.equal(health.success, true); assert.equal(health.data.bookingTransactions, true);
  const inventory = await fetch(`${base}/api/listings?limit=50`).then(r => r.json());
  assert.ok(inventory.data.length);
  const listing = inventory.data[0];
  const shift = n => new Date(Date.now() + n * 86400000).toISOString().slice(0,10);
  // Far-future synthetic two-night stay avoids the relative-date demo seed bookings.
  const body = JSON.stringify({ listingId: listing._id, guestName: 'Deployment smoke sample', guestEmail: 'smoke@example.invalid', numberOfGuests: 1, checkInDate: shift(180), checkOutDate: shift(182) });
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  let id;
  try {
    const first = await fetch(`${base}/api/bookings`, { method:'POST', headers, body });
    assert.equal(first.status,201); const created = await first.json(); id=created.data._id;
    const repeated = await fetch(`${base}/api/bookings`, { method:'POST', headers, body }).then(r=>r.json());
    assert.equal(repeated.data._id,id);
    const conflict = await fetch(`${base}/api/bookings`, { method:'POST', headers:{...headers,'Idempotency-Key':randomUUID()}, body });
    assert.equal(conflict.status,409);
    for (let i=0;i<2;i++) {
      const cancel=await fetch(`${base}/api/bookings/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingStatus:'Cancelled'})});
      assert.equal(cancel.status,200);
    }
    console.log('PASS deployed frontend/API/database health, booking, identical-key replay, conflict and repeat-safe cancellation');
  } finally {
    if(id) await fetch(`${base}/api/bookings/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingStatus:'Cancelled'})});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
