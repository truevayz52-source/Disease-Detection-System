import { Server } from "socket.io"
import type { Server as HttpServer } from "node:http"
import { EventEmitter } from "node:events"
import { verifyToken, tokenHash } from "../auth/jwt.js"
import { query } from "../db.js"
import { config } from "../config.js"
export const events=new EventEmitter()
/** Validates a JWT against live session state; also used by the voice stream. */
export async function validateSessionToken(token:string){
  if(!verifyToken(token))return null
  const [row]=await query<any[]>("SELECT u.user_id, u.role, u.facility_id FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>NOW() AND u.status='active' AND (u.locked_until IS NULL OR u.locked_until<NOW())",[tokenHash(token)])
  return row??null
}
export function attachRealtime(server:HttpServer){
  const io=new Server(server,{cors:{origin:config.clientOrigin},maxHttpBufferSize:16384})
  const valid=async(token:string)=>(await validateSessionToken(token))?.user_id??null
  io.use(async(socket,next)=>{try{const token=socket.handshake.auth.token;if(typeof token!=="string")return next(Error("Unauthorized"));const user=await valid(token);if(!user)return next(Error("Unauthorized"));socket.data.userId=user;next()}catch{next(Error("Service unavailable"))}})
  io.on("connection",socket=>{
    const refresh=async()=>{try{if(!await valid(socket.handshake.auth.token))socket.disconnect(true)}catch{socket.disconnect(true)}}
    const notify=async(userId:string)=>{if(userId!==socket.data.userId)return;try{if(await valid(socket.handshake.auth.token))socket.emit("inbox:changed");else socket.disconnect(true)}catch{socket.disconnect(true)}}
    events.on("inbox",notify)
    const timer=setInterval(refresh,15000)
    socket.on("disconnect",()=>{clearInterval(timer);events.off("inbox",notify)})
  })
  return io
}
