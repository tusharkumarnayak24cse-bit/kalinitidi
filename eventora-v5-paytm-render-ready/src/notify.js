const nodemailer = require("nodemailer");
const twilio = require("twilio");

function emailReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function whatsappReady() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

async function sendTicketEmail(booking) {
  if (!emailReady()) return { skipped:true };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase()==="true",
    auth: { user:process.env.SMTP_USER, pass:process.env.SMTP_PASS }
  });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2>Eventora Ticket Confirmed</h2>
      <p>Hi ${booking.guest_name},</p>
      <p>Your booking is confirmed.</p>
      <p><b>Ticket:</b> ${booking.id}<br>
      <b>Pass:</b> ${booking.pass_type} × ${booking.quantity}<br>
      <b>Amount:</b> ₹${booking.amount}</p>
      <p>Show the QR code below at check-in.</p>
      <img src="${booking.qr_data_url}" width="240" alt="QR ticket">
    </div>`;

  await transporter.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: booking.email,
    subject: `Your Eventora Ticket ${booking.id}`,
    html
  });
  return { sent:true };
}

async function sendWhatsApp(booking) {
  if (!whatsappReady()) return { skipped:true };
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const to = booking.phone.startsWith("whatsapp:") ? booking.phone : `whatsapp:${booking.phone}`;
  const base = process.env.PUBLIC_BASE_URL || "";
  const ticketUrl = base ? `${base}/ticket.html?id=${encodeURIComponent(booking.id)}` : "";
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body: `Eventora booking confirmed ✅\nTicket: ${booking.id}\nPass: ${booking.pass_type} × ${booking.quantity}${ticketUrl ? `\nOpen ticket: ${ticketUrl}` : ""}`
  });
  return { sent:true };
}

async function notifyBooking(booking) {
  const results = {};
  try { results.email = await sendTicketEmail(booking); } catch(e) { results.email={error:e.message}; }
  try { results.whatsapp = await sendWhatsApp(booking); } catch(e) { results.whatsapp={error:e.message}; }
  return results;
}

module.exports = { notifyBooking, emailReady, whatsappReady };
