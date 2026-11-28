import {describe,expect,it} from 'vitest';
import {converterFields,converterLabels,mapNutritionTable,parseNutritionTable,separateDescription,strictNutritionNumber} from '../src/nutrition-table';
import {converterReview,newConverterState,remapConverterTable,reviewNutritionTable,validateConverterState} from '../src/nutrition-converter';
import type {NutritionBatch,NutritionItem} from '../src/food-capture';

const header=converterFields.map(field=>converterLabels[field]);
const cells=['I00001','Rice','100','2','1','20','0','3','','',''];
const markdown=(row=cells)=>`Batch ID: batch-1\n\n| ${header.join(' | ')} |\n| ${header.map(()=>'---').join(' | ')} |\n| ${row.join(' | ')} |`;
function batch(kind:NutritionItem['kind']='draft'):NutritionBatch{
  return{id:'batch-1',created:'',days:[45000],multiDay:false,generated:true,selectOpen:false,reviewNames:false,promptOpen:false,template:'',prompt:'',items:[{id:'I00001',key:'key',kind,name:'Rice',originalName:'Rice',selected:true,includeNotes:false,values:{weight:'47'},restaurant:'',date:45000,source:{row:'draft',part:'part'},photos:[],basis:'',missing:[],fingerprint:'snapshot'}]};
}
function review(source=markdown(),kind:NutritionItem['kind']='draft'){
  const parsed=parseNutritionTable(source);
  return reviewNutritionTable(batch(kind),{batch:parsed.batch,rows:mapNutritionTable(parsed),choices:{},removeDescription:false});
}
describe('nutrition table parser and tracked review',()=>{
  it('preserves blank quantities, real zeros and escaped literal pipes inside fenced Markdown',()=>{
    const row=[...cells];row[1]='Rice \\| noodles';
    const parsed=parseNutritionTable('```markdown\n'+markdown(row)+'\n```');
    expect(mapNutritionTable(parsed)[0]).toMatchObject({name:'Rice | noodles',weight:'',sugar:'0'});
    expect(review().issues).toEqual([]);
    expect(review().items[0].values.weight).toBe('47');
  });
  it('handles quoted commas, escaped quotes, multiline cells and blank trailing CSV/TSV cells',()=>{
    for(const delimiter of [',','\t']){
      const row=[...cells];row[1]='"Rice, ""soup""\nwith vegetables"';
      const parsed=parseNutritionTable(`Batch ID: batch-1\n${header.join(delimiter)}\n${row.join(delimiter)}`);
      expect(mapNutritionTable(parsed)[0]).toMatchObject({name:'Rice, "soup"\nwith vegetables',unit:''});
    }
  });
  it.each(['','-1','1,200','~2','1g','1e3','Infinity','NaN','1/2'])('rejects invalid required numeric cell %j',text=>{
    expect(()=>strictNutritionNumber(text,'protein')).toThrow();
  });
  it('rejects unclosed quotes, ragged rows, duplicated Batch lines and incompatible mapped units',()=>{
    expect(()=>parseNutritionTable(header.join(',')+'\n"I00001,')).toThrow('Unclosed');
    expect(()=>parseNutritionTable(markdown().replace('| 100 |','| 100 | 9 |'))).toThrow('cells');
    expect(()=>parseNutritionTable('Batch ID: batch-1\n'+markdown())).toThrow('exactly one');
    const parsed=parseNutritionTable(markdown());parsed.headers[7]='Sodium (g)';
    expect(()=>mapNutritionTable(parsed)).toThrow('incompatible units');
    parsed.headers[7]='Sodium (mg)';parsed.mapping[7]='calories';
    expect(()=>mapNutritionTable(parsed)).toThrow('only once');
  });
  it('does not select a literal quoted pipe as the CSV delimiter',()=>{
    const parsed=parseNutritionTable(`Batch ID: batch-1\n${header.join(',')},"Description | context"\n${cells.join(',')},"A | B"`);
    expect(mapNutritionTable(parsed)[0].id).toBe('I00001');expect(parsed.rows[0][11]).toBe('A | B');
  });
  it.each(['Sodium (g/serving)','Sodium (g per serving)','Sodium grams per serving'])('blocks qualified sodium gram units: %s',header=>{
    const parsed=parseNutritionTable(markdown());parsed.headers[7]=header;parsed.mapping[7]='sodium';
    expect(()=>mapNutritionTable(parsed)).toThrow('incompatible units');
  });
  it('never matches by a translated name, position or an unknown, duplicate or wrong-batch identity',()=>{
    const row=[...cells];row[1]='Translated meal';
    expect(review(markdown(row)).issues).toEqual([]);
    row[0]='I99999';expect(review(markdown(row)).issues.map(issue=>issue.message).join()).toContain('unknown');
    expect(review(markdown().replace('batch-1','wrong')).issues[0].message).toContain('Batch ID');
    expect(review(markdown()+'\n| '+cells.join(' | ')+' |').issues[0].message).toContain('Duplicate');
  });
  it('blocks unexplained missing requests and requires per-item explicit overwrite review',()=>{
    const b=batch(),parsed=parseNutritionTable(markdown()),rows=mapNutritionTable(parsed);
    b.items.push({...b.items[0],id:'I00002',key:'second'});b.items[0].values.calories='50';
    const result=reviewNutritionTable(b,{batch:b.id,rows,choices:{},removeDescription:false});
    expect(result.issues).toHaveLength(3);
    expect(reviewNutritionTable(b,{batch:b.id,rows,choices:{I00001:{overwrite:true},I00002:{missingReason:'Will estimate later'}},removeDescription:false}).issues).toEqual([]);
  });
  it('never takes response quantities as Ingredient nutrient basis and requires explicit acknowledgment',()=>{
    const b=batch('ingredient');b.items[0].values.weight='25';
    const parsed=parseNutritionTable(markdown()),rows=mapNutritionTable(parsed);rows[0].weight='50';
    expect(reviewNutritionTable(b,{batch:b.id,rows,choices:{},removeDescription:false}).issues[0].message).toContain('captured reference');
    const result=reviewNutritionTable(b,{batch:b.id,rows,choices:{I00001:{referenceAcknowledged:true}},removeDescription:false});
    expect(result.issues).toEqual([]);expect(result.items[0].values.weight).toBe('25');
    expect(rows[0].weight).toBe('50');
  });
  it('requires Draft returned quantities blank, not zero or guessed 100g',()=>{
    const row=[...cells];row[8]='0';expect(review(markdown(row)).issues[0].message).toContain('must be blank');
  });
  it('splits only a final balanced description and retains original row text for reversal',()=>{
    expect(separateDescription('Soup (vegetables (fresh))')).toEqual({name:'Soup',description:' (vegetables (fresh))'});
    expect(separateDescription('Soup (open')).toEqual({name:'Soup (open',description:''});
    const row=[...cells];row[1]='Soup (vegetables)';
    const parsed=parseNutritionTable(markdown(row)),rows=mapNutritionTable(parsed);
    const result=reviewNutritionTable(batch(),{batch:'batch-1',rows,choices:{},removeDescription:true});
    expect(result.items[0]).toMatchObject({values:{food:'Soup'},description:' (vegetables)'});
    expect(rows[0].name).toBe('Soup (vegetables)');
  });
  it('validates persisted state, without accepting malformed mappings or choices',()=>{
    const state=newConverterState();expect(()=>validateConverterState(state)).not.toThrow();
    expect(()=>validateConverterState({...state,choices:{I00001:{overwrite:'yes'}}})).toThrow();
    const parsed=parseNutritionTable(markdown());expect(()=>validateConverterState({...state,parsed})).not.toThrow();
    parsed.mapping.pop();expect(()=>validateConverterState({...state,parsed})).toThrow();
  });
  it('restores pending column choices without applying them, and commits only a successful explicit rebuild',()=>{
    const raw=markdown(),parsed=parseNutritionTable(raw),state={...newConverterState('batch-1'),raw,processedRaw:raw,parsed,rows:mapNutritionTable(parsed),pendingMapping:[...parsed.mapping]};
    [state.pendingMapping[3],state.pendingMapping[4]]=[state.pendingMapping[4],state.pendingMapping[3]];
    const restored=JSON.parse(JSON.stringify(state));validateConverterState(restored);
    expect(()=>converterReview(restored)).toThrow('Rebuild the pending column mapping');
    expect(restored.rows[0]).toMatchObject({protein:'2',fat:'1'});
    const before=structuredClone(restored),invalid=[...restored.pendingMapping!];invalid[3]=invalid[4];
    expect(()=>remapConverterTable(restored,invalid)).toThrow('only once');
    expect(restored).toEqual(before);
    const rebuilt=remapConverterTable(restored,restored.pendingMapping!);
    expect(rebuilt.pendingMapping).toBeUndefined();
    expect(converterReview(rebuilt).rows[0]).toMatchObject({protein:'1',fat:'2'});
    expect(restored).toEqual(before);
    expect(()=>validateConverterState({...state,pendingMapping:['name']})).toThrow('pending converter mapping');
    expect(()=>validateConverterState({...state,pendingMapping:state.pendingMapping.map(()=>'unknown')})).toThrow('pending converter mapping');
  });
});
