import { expect,it } from 'vitest';
import { Engine } from '../src/formula';
import { defaultHeaderFormula,groupBlockToTop,positionalBlock } from '../src/meal-block';
import { blankSheet,clone,key,move,setInput,uid,type Workbook } from '../src/model';

function fixture(){
  const s=blankSheet('Invented meals',12,6),b:Workbook={schema:1,id:uid(),title:'Synthetic meals',revision:0,sheets:[s],tables:[],names:[],pickerSources:{}};
  const t={id:uid(),name:'Meals',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,8).map(r=>r.id),columns:['Meal','Calories','Portions','isMeal'].map((name,i)=>({id:uid(),column:s.columns[i].id,name}))};
  b.tables.push(t);
  const values=[['First','','2','TRUE'],['','100','','FALSE'],['','200','','FALSE'],['Second','','1','TRUE'],['','50','','FALSE'],['Empty','','1','TRUE'],['Final','','1','TRUE']];
  t.columns.forEach(c=>setInput(b,s,t.header,c.column,c.name));
  values.forEach((v,i)=>v.forEach((x,j)=>setInput(b,s,t.rows[i],t.columns[j].column,x)));
  for(const i of [1,4,6,7])setInput(b,s,s.rows[i].id,s.columns[1].id,defaultHeaderFormula(b,t,t.columns[1].id));
  s.cells[key(s.rows[5].id,s.columns[0].id)]={value:'',note:'Synthetic recipe',format:{wrap:false}};
  s.validations.push({id:uid(),sheet:s.id,rows:[s.rows[5].id],columns:[s.columns[0].id],values:['x'],source:'="x"'});
  s.groups.push({id:uid(),axis:'row',members:[s.rows[2].id,s.rows[3].id],collapsed:false,label:'Other meal details'});
  const value=(row:string)=>new Engine(b).cell(s.id,row,s.columns[1].id);
  return{b,s,t,value};
}
it('safely totals final, consecutive-empty and one-record headers without altering evaluator semantics',()=>{
  const{b,s,t,value}=fixture();expect(value(s.rows[1].id)).toBe(150);expect(value(s.rows[4].id)).toBe(50);expect(value(s.rows[6].id)).toBe(0);expect(value(s.rows[7].id)).toBe(0);
  t.rows=[s.rows[7].id];expect(value(s.rows[7].id)).toBe(0);
  expect(new Engine(b).evaluate({kind:'call',name:'XMATCH',args:[{kind:'literal',value:true},{kind:'literal',value:false},{kind:'literal',value:0}]},s.id,s.rows[7].id,s.columns[5].id)).toMatchObject({error:'#N/A'});
});
it('moves the selected ingredient owning block, collapses only its details, and retains notes, validation and other groups',()=>{
  const{b,s,t,value}=fixture(),header=s.rows[4].id,ingredient=s.rows[5].id,other=clone(s.groups[0]),validation=clone(s.validations),cells=clone(s.cells),next=s.rows[6].id;
  expect(positionalBlock(b,s,t,ingredient)).toEqual([header,ingredient]);
  expect(groupBlockToTop(b,s,t,ingredient)).toBe(1);expect(s.rows.slice(1,3).map(r=>r.id)).toEqual([header,ingredient]);expect(t.rows.slice(0,2)).toEqual([header,ingredient]);
  expect(s.rows[3].id).not.toBe(next);expect(s.cells).toEqual(cells);expect(s.validations).toEqual(validation);expect(s.groups[0]).toEqual(other);
  expect(s.groups.find(g=>g.members.includes(ingredient))).toMatchObject({members:[ingredient],collapsed:true});
  expect(s.groups.filter(g=>g.collapsed).some(g=>g.members.includes(header))).toBe(false);expect(value(header)).toBe(50);
  const groups=s.groups.length;groupBlockToTop(b,s,t,header);expect(s.groups).toHaveLength(groups);
});
it('keeps membership positional when an ingredient crosses a header, without permanent meal foreign keys',()=>{
  const{b,s,t,value}=fixture(),first=s.rows[1].id,second=s.rows[4].id,ingredient=s.rows[3].id;
  move(s.rows,3,5);const order=new Map(s.rows.map((r,i)=>[r.id,i]));t.rows.sort((a,b)=>order.get(a)!-order.get(b)!);
  expect(positionalBlock(b,s,t,ingredient)[0]).toBe(second);expect(value(first)).toBe(50);expect(value(second)).toBe(250);
});
it('handles final or empty meals without swallowing unrelated freeform rows and refuses a fragmented block',()=>{
  const{b,s,t}=fixture(),final=s.rows[7].id,free=s.rows[8].id;
  groupBlockToTop(b,s,t,final);expect(s.rows[1].id).toBe(final);expect(s.rows.findIndex(r=>r.id===free)).toBe(8);expect(s.groups.some(g=>g.members.includes(final))).toBe(false);
  const f=fixture();f.s.rows.splice(5,0,{id:uid()});const before=clone(f.b);
  expect(()=>groupBlockToTop(f.b,f.s,f.t,f.t.rows[4])).toThrow('intervening');expect(f.b).toEqual(before);
});
