require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const Razorpay = require("razorpay");
const PaytmChecksum = require("paytmchecksum");
const { v4: uuidv4 } = require("uuid");
const db = require("./src/db");
const { notifyBooking, emailReady, whatsappReady } = require("./src/notify");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy:false }));

function clean(v,max=120){ return String(v||"").trim().slice(0,max); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function razorpayReady(){
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
function rp(){
  return new Razorpay({
    key_id:process.env.RAZORPAY_KEY_ID,
    key_secret:process.env.RAZORPAY_KEY_SECRET
  });
}

function paytmReady(){
  return !!(process.env.PAYTM_MID && process.env.PAYTM_MERCHANT_KEY);
}
function paytmBase(){
  return String(process.env.PAYTM_ENV||"staging").toLowerCase()==="production"
    ? "https://securegw.paytm.in"
    : "https://securegw-stage.paytm.in";
}
function publicBase(req){
  if(process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/,"");
  return `${req.protocol}://${req.get("host")}`;
}

function signAdmin(){
  return jwt.sign(
    {role:"admin",email:(process.env.ADMIN_EMAIL||"admin@eventora.local").toLowerCase()},
    process.env.JWT_SECRET || "dev-secret-change-me",
    {expiresIn:"8h"}
  );
}
function requireAdmin(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{
    req.admin=jwt.verify(token,process.env.JWT_SECRET || "dev-secret-change-me");
    next();
  }catch{
    res.status(401).json({error:"Authentication required"});
  }
}

async function attachQr(id){
  const b=await db.getBooking(id);
  if(!b) return null;
  const qr=await QRCode.toDataURL(JSON.stringify({
    ticket:b.id,event:b.event_id,guest:b.guest_name,qty:b.quantity
  }),{margin:1,width:360});
  return db.updateBooking(id,{qr_data_url:qr});
}

async function confirmAndNotify(id, paymentId=null){
  const fields={status:"confirmed"};
  if(paymentId) fields.razorpay_payment_id=paymentId;
  await db.updateBooking(id,fields);
  const b=await attachQr(id);
  notifyBooking(b).catch(console.error);
  return b;
}

// Razorpay webhook - raw body
app.post("/api/razorpay/webhook",
  express.raw({type:"application/json"}),
  async (req,res)=>{
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
    if(!secret) return res.status(503).json({error:"Webhook not configured"});
    const signature=String(req.headers["x-razorpay-signature"]||"");
    const digest=crypto.createHmac("sha256",secret).update(req.body).digest("hex");
    if(digest!==signature) return res.status(400).json({error:"Invalid signature"});
    res.json({received:true});
  }
);

// Paytm callback uses form-urlencoded body.
app.post("/api/paytm/callback",
  express.urlencoded({extended:false}),
  async (req,res)=>{
    try{
      if(!paytmReady()) return res.status(503).send("Paytm is not configured.");
      const body={...req.body};
      const checksum=body.CHECKSUMHASH;
      delete body.CHECKSUMHASH;

      const valid=PaytmChecksum.verifySignature(
        body,
        process.env.PAYTM_MERCHANT_KEY,
        checksum
      );
      if(!valid) return res.status(400).send("Invalid Paytm checksum.");

      const orderId=clean(body.ORDERID,100);
      const booking=await db.getBooking(orderId);
      if(!booking) return res.status(404).send("Booking not found.");

      // Always verify final status server-to-server.
      const statusBody={
        mid:process.env.PAYTM_MID,
        orderId
      };
      const signature=await PaytmChecksum.generateSignature(
        JSON.stringify(statusBody),
        process.env.PAYTM_MERCHANT_KEY
      );
      const statusResp=await fetch(`${paytmBase()}/v3/order/status`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({body:statusBody,head:{signature}})
      });
      const statusData=await statusResp.json();
      const resultStatus=statusData?.body?.resultInfo?.resultStatus;

      if(resultStatus==="TXN_SUCCESS"){
        const txnId=statusData?.body?.txnId || body.TXNID || "PAYTM";
        const confirmed=await confirmAndNotify(orderId,`PAYTM:${txnId}`);
        return res.redirect(`/ticket.html?id=${encodeURIComponent(confirmed.id)}`);
      }

      await db.updateBooking(orderId,{status:"payment-failed"});
      return res.redirect(`/payment-result.html?status=failed&id=${encodeURIComponent(orderId)}`);
    }catch(e){
      console.error("Paytm callback error",e);
      return res.status(500).send("Paytm verification failed.");
    }
  }
);

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/api",rateLimit({windowMs:60*1000,max:150}));

app.get("/api/health",(req,res)=>res.json({
  ok:true,
  service:"Eventora V5",
  database:db.usePostgres?"postgres":"json-fallback"
}));

app.get("/api/config",(req,res)=>res.json({
  razorpayEnabled:razorpayReady(),
  razorpayKeyId:razorpayReady()?process.env.RAZORPAY_KEY_ID:null,
  paytmEnabled:paytmReady(),
  paytmMid:paytmReady()?process.env.PAYTM_MID:null,
  paytmEnv:process.env.PAYTM_ENV||"staging",
  database:db.usePostgres?"postgres":"json-fallback",
  emailEnabled:emailReady(),
  whatsappEnabled:whatsappReady()
}));

app.get("/api/events",async(req,res)=>{
  try{res.json(await db.getEvents())}
  catch(e){console.error(e);res.status(500).json({error:"Could not load events"})}
});

app.post("/api/admin/login",(req,res)=>{
  const email=clean(req.body.email,180).toLowerCase();
  const password=String(req.body.password||"");
  const adminEmail=(process.env.ADMIN_EMAIL||"admin@eventora.local").toLowerCase();
  const adminPassword=process.env.ADMIN_PASSWORD||"ChangeThis123!";
  if(email!==adminEmail||password!==adminPassword)
    return res.status(401).json({error:"Invalid email or password"});
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
    const provider=clean(req.body.paymentProvider,30).toLowerCase();

    if(!guestName||!phone||!validEmail(email))
      return res.status(400).json({error:"Please enter valid contact details"});

    const event=(await db.getEvents()).find(e=>e.id===eventId);
    if(!event) return res.status(404).json({error:"Event not found"});
    if(!Object.prototype.hasOwnProperty.call(event.passes,passType))
      return res.status(400).json({error:"Invalid pass type"});
    if(quantity>event.remaining)
      return res.status(409).json({error:`Only ${event.remaining} tickets remain`});

    const amount=Number(event.passes[passType])*quantity;
    const id="EVT-"+uuidv4().split("-")[0].toUpperCase();

    let selected=provider;
    if(!selected){
      if(razorpayReady()) selected="razorpay";
      else if(paytmReady()) selected="paytm";
      else selected="demo";
    }

    if(selected==="razorpay"&&!razorpayReady())
      return res.status(400).json({error:"Razorpay is not configured"});
    if(selected==="paytm"&&!paytmReady())
      return res.status(400).json({error:"Paytm is not configured"});

    let status="demo-confirmed";
    let razorpayOrderId=null;

    if(selected==="razorpay"){
      status="payment-pending";
      const order=await rp().orders.create({
        amount:amount*100,
        currency:"INR",
        receipt:id,
        notes:{bookingId:id,eventId}
      });
      razorpayOrderId=order.id;
    }else if(selected==="paytm"){
      status="payment-pending";
    }

    let booking=await db.createBooking({
      id,event_id:eventId,guest_name:guestName,phone,email,pass_type:passType,
      quantity,amount,status,razorpay_order_id:razorpayOrderId,
      razorpay_payment_id:null,qr_data_url:null,checked_in:false,
      checked_in_at:null,created_at:new Date().toISOString()
    });

    if(selected==="demo"){
      booking=await attachQr(id);
      notifyBooking(booking).catch(console.error);
    }

    res.json({
      booking,
      paymentProvider:selected,
      razorpayKeyId:selected==="razorpay"?process.env.RAZORPAY_KEY_ID:null
    });
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Could not create booking"});
  }
});

app.post("/api/paytm/initiate",async(req,res)=>{
  try{
    if(!paytmReady()) return res.status(400).json({error:"Paytm is not configured"});
    const bookingId=clean(req.body.bookingId,80);
    const booking=await db.getBooking(bookingId);
    if(!booking) return res.status(404).json({error:"Booking not found"});
    if(booking.status!=="payment-pending")
      return res.status(400).json({error:"Booking is not awaiting payment"});

    const callbackUrl=`${publicBase(req)}/api/paytm/callback`;
    const body={
      requestType:"Payment",
      mid:process.env.PAYTM_MID,
      websiteName:process.env.PAYTM_WEBSITE || "WEBSTAGING",
      orderId:booking.id,
      callbackUrl,
      txnAmount:{
        value:Number(booking.amount).toFixed(2),
        currency:"INR"
      },
      userInfo:{
        custId:booking.email || booking.phone || booking.id
      }
    };

    const signature=await PaytmChecksum.generateSignature(
      JSON.stringify(body),
      process.env.PAYTM_MERCHANT_KEY
    );

    const url=`${paytmBase()}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(process.env.PAYTM_MID)}&orderId=${encodeURIComponent(booking.id)}`;
    const response=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({body,head:{signature}})
    });
    const data=await response.json();

    if(data?.body?.resultInfo?.resultStatus!=="S"){
      return res.status(502).json({
        error:data?.body?.resultInfo?.resultMsg || "Paytm could not initiate transaction"
      });
    }

    res.json({
      txnToken:data.body.txnToken,
      orderId:booking.id,
      amount:Number(booking.amount).toFixed(2),
      mid:process.env.PAYTM_MID,
      environment:process.env.PAYTM_ENV||"staging"
    });
  }catch(e){
    console.error("Paytm initiate error",e);
    res.status(500).json({error:"Could not initiate Paytm transaction"});
  }
});

app.post("/api/payments/verify",async(req,res)=>{
  try{
    if(!razorpayReady()) return res.status(400).json({error:"Razorpay not configured"});
    const bookingId=clean(req.body.bookingId,80);
    const orderId=clean(req.body.razorpay_order_id,120);
    const paymentId=clean(req.body.razorpay_payment_id,120);
    const signature=clean(req.body.razorpay_signature,200);
    const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`).digest("hex");
    if(expected!==signature)
      return res.status(400).json({error:"Payment verification failed"});
    const b=await db.getBooking(bookingId);
    if(!b||b.razorpay_order_id!==orderId)
      return res.status(404).json({error:"Booking not found"});
    res.json({booking:await confirmAndNotify(bookingId,paymentId)});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Payment verification failed"});
  }
});

app.get("/api/tickets/:id",async(req,res)=>{
  const b=await db.getBooking(clean(req.params.id,80));
  if(!b) return res.status(404).json({error:"Ticket not found"});
  if(!["confirmed","demo-confirmed"].includes(b.status))
    return res.status(403).json({error:"Ticket is not confirmed"});
  res.json(b);
});

app.get("/api/admin/stats",requireAdmin,async(req,res)=>res.json(await db.stats()));
app.get("/api/admin/bookings",requireAdmin,async(req,res)=>res.json(await db.listBookings()));

app.post("/api/admin/checkin",requireAdmin,async(req,res)=>{
  try{
    const ticketId=clean(req.body.ticketId,80);
    const b=await db.getBooking(ticketId);
    if(!b) return res.status(404).json({error:"Ticket not found"});
    if(!["confirmed","demo-confirmed"].includes(b.status))
      return res.status(403).json({error:"Ticket is not confirmed"});
    if(Boolean(b.checked_in))
      return res.status(409).json({error:`Already checked in${b.checked_in_at?` at ${b.checked_in_at}`:""}`});
    const at=new Date().toISOString();
    const updated=await db.updateBooking(ticketId,{checked_in:true,checked_in_at:at});
    res.json({ok:true,booking:updated,checkedInAt:at});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Check-in failed"});
  }
});

db.initDb().then(()=>{
  app.listen(PORT,"0.0.0.0",()=>console.log(`Eventora V5 running on port ${PORT}`));
}).catch(err=>{
  console.error("Database initialization failed:",err);
  process.exit(1);
});
