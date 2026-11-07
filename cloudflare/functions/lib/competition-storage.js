// Large 200-player leagues keep the same atomic D1 record and privacy model.
// Old JSON rows remain readable; no migration or extra database is needed.
const MAX_RAW = 24 * 1024 * 1024;
function capacity() { throw Object.assign(new Error('competition_capacity'), {status:409}); }
export async function encodeCompetition(value) {
  const text=JSON.stringify(value),bytes=new TextEncoder().encode(text);
  if(bytes.length>MAX_RAW) capacity();
  if(bytes.length<500000) return text;
  const compressed=new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';
  for(let i=0;i<compressed.length;i+=8192) binary+=String.fromCharCode(...compressed.subarray(i,i+8192));
  const packed=JSON.stringify({storage:'deuce-competition-gzip-v1',data:btoa(binary)});
  if(new TextEncoder().encode(packed).length>1800000) capacity();
  return packed;
}
export async function decodeCompetition(text) {
  const value=JSON.parse(text);
  if(value.storage!=='deuce-competition-gzip-v1') return value;
  const binary=atob(value.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const reader=new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[];let total=0;
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RAW)capacity();chunks.push(value);}
  } finally {await reader.cancel();}
  const raw=new Uint8Array(total);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(raw));
}
