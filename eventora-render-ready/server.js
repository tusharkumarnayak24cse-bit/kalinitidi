require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data");
const BOOKINGS = path.join(DATA, "bookings.json");
const EVENTS = path.join(DATA, "events.json");

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/api", rateLimit({windowMs:60*1000,max:120}));

function read(file){ return JSON.parse(fs.readFileSync(file,"utf8")); }
function write(file,data){ fs.writeFileSync(file,JSON.stringify(data,null,2)); }
function eventsWithStats(){
  const events=read(EVENTS), bookings=read(BOOKINGS);
  return events.filter(e=>e.status==="active").map(e=>{
    const sold=bookings.filter(b=>b.event_id===e.id && ["confirmed","demo-confirmed"].includes(b.status))
      .reduce((s,b)=>s+Number(b.quantity||0),0);
    return {...e,sold,remaining:Math.max(0,e.capacity-sold)};
  });
}
function clean(v,max=120){ return String(v||"").trim().slice(0,max); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function paymentReady(){ return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET); }
function rp(){ return new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}); }
function signAdmin(){
  return jwt.sign(
    {role:"admin",email:process.env.ADMIN_EMAIL || "admin@eventora.local"},
    process.env.JWT_SECRET || "dev-secret",
    {expiresIn:"8h"}
  );
}
function requireAdmin(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{
    req.admin=jwt.verify(token,process.env.JWT_SECRET || "dev-secret");
    next();
  }catch{
    res.status(401).json({error:"Authentication required"});
  }
}
async function addQr(id){
  const bookings=read(BOOKINGS);
  const b=bookings.find(x=>x.id===id);
  if(!b) return null;
  b.qr_data_url = await QRCode.toDataURL(JSON.stringify({
    ticket:b.id,event:b.event_id,guest:b.guest_name,qty:b.quantity
  }),{margin:1,width:320});
  write(BOOKINGS,bookings);
  return b;
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"Eventora Railway"}));
app.get("/api/config",(req,res)=>res.json({
  paymentMode:paymentReady()?"razorpay":"demo",
  razorpayKeyId:paymentReady()?process.env.RAZORPAY_KEY_ID:null
}));
app.get("/api/events",(req,res)=>res.json(eventsWithStats()));

app.post("/api/admin/login",async(req,res)=>{
  const email=clean(req.body.email,180).toLowerCase();
  const password=String(req.body.password||"");
  const adminEmail=(process.env.ADMIN_EMAIL || "admin@eventora.local").toLowerCase();
  const adminPassword=process.env.ADMIN_PASSWORD || "ChangeThis123!";
  const hash=await bcrypt.hash(adminPassword,10);
  const ok=email===adminEmail && await bcrypt.compare(password,hash);
  if(!ok) return res.status(401).json({error:"Invalid email or password"});
  res.json({token:signAdmin(),admin:{email:adminEmail}});
});

app.post("/api/bookings",async(req,res)=>{
  try{
    const eventId=clean(req.body.eventId,80);
    const guestName=clean(req.body.name,100);
    const phone=clean(req.body.phone,30);
    const email=clean(req.body.email,180).toLowerCase();
    const passType=clean(req.body.passType,40);
    const quantity=Math.max(1,Math.min(10,Number(req.body.quantity||1)));

    if(!guestName||!phone||!validEmail(email))
      return res.status(400).json({error:"Please enter valid contact details"});

    const event=eventsWithStats().find(e=>e.id===eventId);
    if(!event) return res.status(404).json({error:"Event not found"});
    if(!Object.prototype.hasOwnProperty.call(event.passes,passType))
      return res.status(400).json({error:"Invalid pass type"});
    if(quantity>event.remaining)
      return res.status(409).json({error:`Only ${event.remaining} tickets remain`});

    const amount=event.passes[passType]*quantity;
    const id="EVT-"+uuidv4().split("-")[0].toUpperCase();
    let orderId=null;
    let status=paymentReady()?"payment-pending":"demo-confirmed";

    if(paymentReady()){
      const order=await rp().orders.create({
        amount:amount*100,currency:"INR",receipt:id,
        notes:{bookingId:id,eventId}
      });
      orderId=order.id;
    }

    const bookings=read(BOOKINGS);
    const booking={
      id,event_id:eventId,guest_name:guestName,phone,email,
      pass_type:passType,quantity,amount,status,
      razorpay_order_id:orderId,razorpay_payment_id:null,
      qr_data_url:null,checked_in:false,checked_in_at:null,
      created_at:new Date().toISOString()
    };
    bookings.push(booking);
    write(BOOKINGS,bookings);

    const finalBooking=status==="demo-confirmed"?await addQr(id):booking;
    res.json({booking:finalBooking,paymentRequired:paymentReady(),
      razorpayKeyId:paymentReady()?process.env.RAZORPAY_KEY_ID:null});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Could not create booking"});
  }
});

app.post("/api/payments/verify",async(req,res)=>{
  if(!paymentReady()) return res.status(400).json({error:"Razorpay not configured"});
  const bookingId=clean(req.body.bookingId,80);
  const orderId=clean(req.body.razorpay_order_id,120);
  const paymentId=clean(req.body.razorpay_payment_id,120);
  const signature=clean(req.body.razorpay_signature,200);

  const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`).digest("hex");
  if(expected!==signature) return res.status(400).json({error:"Payment verification failed"});

  const bookings=read(BOOKINGS);
  const b=bookings.find(x=>x.id===bookingId && x.razorpay_order_id===orderId);
  if(!b) return res.status(404).json({error:"Booking not found"});
  b.status="confirmed"; b.razorpay_payment_id=paymentId;
  write(BOOKINGS,bookings);
  res.json({booking:await addQr(bookingId)});
});

app.get("/api/admin/stats",requireAdmin,(req,res)=>{
  const b=read(BOOKINGS);
  const confirmed=b.filter(x=>["confirmed","demo-confirmed"].includes(x.status));
  res.json({
    total:b.length,
    confirmed:confirmed.length,
    tickets:confirmed.reduce((s,x)=>s+Number(x.quantity||0),0),
    revenue:confirmed.reduce((s,x)=>s+Number(x.amount||0),0),
    checkedIn:b.filter(x=>x.checked_in).length
  });
});

app.get("/api/admin/bookings",requireAdmin,(req,res)=>{
  const eventMap=Object.fromEntries(read(EVENTS).map(e=>[e.id,e.name]));
  res.json(read(BOOKINGS).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .map(x=>({...x,event_name:eventMap[x.event_id]||x.event_id})));
});

app.post("/api/admin/checkin",requireAdmin,(req,res)=>{
  const ticketId=clean(req.body.ticketId,80);
  const bookings=read(BOOKINGS);
  const b=bookings.find(x=>x.id===ticketId);
  if(!b) return res.status(404).json({error:"Ticket not found"});
  if(!["confirmed","demo-confirmed"].includes(b.status))
    return res.status(403).json({error:"Ticket is not confirmed"});
  if(b.checked_in)
    return res.status(409).json({error:`Already checked in at ${b.checked_in_at}`});
  b.checked_in=true; b.checked_in_at=new Date().toISOString();
  write(BOOKINGS,bookings);
  res.json({ok:true,booking:b,checkedInAt:b.checked_in_at});
});

app.listen(PORT,"0.0.0.0",()=>{
  console.log(`Eventora Railway running on port ${PORT}`);
});