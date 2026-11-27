import {photoByteLimit} from './food-photos';

export const photoPixelLimit=32_000_000;
export interface PhotoDimensions {width:number;height:number}

export function photoDimensions(data:Uint8Array,mime:string):PhotoDimensions{
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const text=(offset:number,length:number)=>String.fromCharCode(...data.subarray(offset,offset+length));
  let width=0,height=0;
  if(mime==='image/png'&&data.length>=24&&text(12,4)==='IHDR'){
    width=view.getUint32(16);height=view.getUint32(20);
  }else if(mime==='image/gif'&&data.length>=10&&(text(0,6)==='GIF87a'||text(0,6)==='GIF89a')){
    width=view.getUint16(6,true);height=view.getUint16(8,true);
  }else if(mime==='image/webp'&&data.length>=30&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
    const format=text(12,4);
    if(format==='VP8X'){
      width=1+data[24]+data[25]*256+data[26]*65536;
      height=1+data[27]+data[28]*256+data[29]*65536;
    }else if(format==='VP8L'&&data[20]===47){
      width=1+((data[21]|data[22]<<8)&16383);
      height=1+((data[22]>>6|data[23]<<2|data[24]<<10)&16383);
    }else if(format==='VP8 '&&data[23]===157&&data[24]===1&&data[25]===42){
      width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;
    }
  }else if(mime==='image/jpeg'&&data[0]===255&&data[1]===216){
    let offset=2;
    while(offset<data.length){
      if(data[offset++]!==255)break;
      while(offset<data.length&&data[offset]===255)offset++;
      const marker=data[offset++];
      if(marker===217||marker===218||marker===undefined)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(offset+2>data.length)break;
      const length=view.getUint16(offset);
      if(length<2||offset+length>data.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){
        height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;
      }
      offset+=length;
    }
  }
  if(!width||!height)throw Error('The photo has an invalid or unsupported image header.');
  if(width>32768||height>32768||width*height>photoPixelLimit)throw Error('Photos must be at most 32 megapixels and 32,768 pixels on either side. Resize this image on your device first.');
  return{width,height};
}

export async function makePhotoThumbnail(blob:Blob):Promise<Blob>{
  if(!blob.size||blob.size>photoByteLimit)throw Error('Each photo must be nonempty and at most 12 MB.');
  photoDimensions(new Uint8Array(await blob.arrayBuffer()),blob.type);
  let image:ImageBitmap|HTMLImageElement|undefined,url:string|undefined;
  try{
    if(typeof createImageBitmap==='function')image=await createImageBitmap(blob,{imageOrientation:'from-image'});
    else{
      url=URL.createObjectURL(blob);
      const element=new Image();
      await new Promise<void>((resolve,reject)=>{
        element.onload=()=>resolve();element.onerror=()=>reject(Error('The browser could not decode this photo.'));
        element.src=url!;
      });
      image=element;
    }
    const width=image instanceof HTMLImageElement?image.naturalWidth:image.width,height=image instanceof HTMLImageElement?image.naturalHeight:image.height;
    if(!width||!height||width*height>photoPixelLimit)throw Error('The decoded photo exceeds the supported image dimensions.');
    const ratio=Math.min(1,256/Math.max(width,height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw Error('This browser could not create a photo preview.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(result=>{
      if(result&&result.size<=128*1024)resolve(result);else reject(Error('This browser could not create a bounded photo preview.'));
    },'image/jpeg',0.82));
  }catch(error){
    throw Error(`Photo preview failed: ${error instanceof Error?error.message:String(error)} The original was not changed.`);
  }finally{
    if(image&&'close'in image)image.close();
    if(image instanceof HTMLImageElement){image.onload=null;image.onerror=null;image.removeAttribute('src');}
    if(url)URL.revokeObjectURL(url);
  }
}
