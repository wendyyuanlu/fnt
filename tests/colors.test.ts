import {expect,it} from 'vitest';
import {hexToHsv,hsvToHex,normalizeHex} from '../src/colors';

it('roundtrips primary, custom and grayscale colors without losing RGB precision',()=>{
  for(const color of ['#ff0000','#00ff00','#0000ff','#ffffff','#000000','#808080','#195747','#123456','#ffc000']){
    const {h,s,v}=hexToHsv(color);expect(hsvToHex(h,s,v)).toBe(color);
  }
  expect(hsvToHex(360,1,1)).toBe('#ff0000');expect(hsvToHex(-120,1,1)).toBe('#0000ff');
});
it('rejects incomplete colors and invalid shade inputs',()=>{
  expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
  for(const value of ['#123','#12345g','red',''])expect(()=>hexToHsv(value)).toThrow('six-digit');
  expect(()=>hsvToHex(NaN,0,0)).toThrow();expect(()=>hsvToHex(0,2,1)).toThrow();
});
