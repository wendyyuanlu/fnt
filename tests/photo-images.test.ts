import {describe,expect,it} from 'vitest';
import {photoDimensions} from '../src/photo-images';

function header(mime:string,width:number,height:number):Uint8Array{
  const bytes=new Uint8Array(32),view=new DataView(bytes.buffer);
  const text=(offset:number,value:string)=>bytes.set([...value].map(char=>char.charCodeAt(0)),offset);
  if(mime==='image/png'){text(12,'IHDR');view.setUint32(16,width);view.setUint32(20,height);}
  if(mime==='image/gif'){text(0,'GIF89a');view.setUint16(6,width,true);view.setUint16(8,height,true);}
  if(mime==='image/jpeg'){bytes.set([255,216,255,194,0,8,8]);view.setUint16(7,height);view.setUint16(9,width);}
  if(mime==='image/webp'){text(0,'RIFF');text(8,'WEBP');text(12,'VP8X');for(let n=0;n<3;n++){bytes[24+n]=(width-1)>>>8*n;bytes[27+n]=(height-1)>>>8*n;}}
  return bytes;
}
describe('photo dimensions before browser decoding',()=>{
  it.each(['image/png','image/gif','image/jpeg','image/webp'])('reads bounded %s dimensions, including nonzero byte offsets',mime=>{
    const bytes=header(mime,4032,3024),offset=new Uint8Array(40);offset.set(bytes,5);
    expect(photoDimensions(offset.subarray(5,37),mime)).toEqual({width:4032,height:3024});
    expect(()=>photoDimensions(header(mime,8192,8192),mime)).toThrow('32 megapixels');
    expect(()=>photoDimensions(bytes.subarray(0,5),mime)).toThrow('header');
  });
  it('reads lossy and lossless WebP headers',()=>{
    const lossy=header('image/webp',1,1);lossy.set([86,80,56,32],12);lossy.set([157,1,42],23);
    new DataView(lossy.buffer).setUint16(26,640,true);new DataView(lossy.buffer).setUint16(28,480,true);
    expect(photoDimensions(lossy,'image/webp')).toEqual({width:640,height:480});
    const lossless=header('image/webp',1,1),bits=(640-1)|((480-1)<<14);
    lossless.set([86,80,56,76],12);lossless[20]=47;new DataView(lossless.buffer).setUint32(21,bits,true);
    expect(photoDimensions(lossless,'image/webp')).toEqual({width:640,height:480});
  });
  it('rejects zero dimensions and malformed JPEG segments instead of attempting a decode',()=>{
    expect(()=>photoDimensions(header('image/png',0,20),'image/png')).toThrow('header');
    const jpeg=header('image/jpeg',640,480);jpeg[5]=1;
    expect(()=>photoDimensions(jpeg,'image/jpeg')).toThrow('header');
    expect(()=>photoDimensions(header('image/png',32769,1),'image/png')).toThrow('32,768');
  });
});
