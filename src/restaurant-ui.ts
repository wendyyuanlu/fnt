import {dropdownArrowHtml,mountDropdownOptions,mountDropdownPopup} from './dropdown-ui';
import {deleteRestaurant,renameRestaurant,restaurantFoods,restaurantName,setRestaurant,type RestaurantLink} from './food-capture';
import type {Engine} from './formula';
import {toolbarIcon} from './icons';
import type {Workbook} from './model';
import type {Patch} from './undo-history';

export interface RestaurantHost{
  book:()=>Workbook;engine:()=>Engine;
  write:(label:string,paths:Patch['path'][],change:()=>void)=>boolean;
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  changed:()=>void;error:(error:unknown)=>void;
}
export interface RestaurantField{refresh:(disabled?:boolean)=>void;dispose:()=>void}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const restaurantFieldHtml=()=>`<label class="meal-log-field"><span>Restaurant</span><span class="meal-log-input"><input data-restaurant-input aria-label="Restaurant" autocomplete="off"><button type="button" class="icon-button" data-restaurant-picker aria-label="Choose restaurant"><span class="format-caret">${dropdownArrowHtml}</span></button></span></label><div class="button-row"><button type="button" class="icon-button" data-unlink-restaurant aria-label="Unlink restaurant" title="Unlink restaurant">${toolbarIcon('unlink')}</button></div>`;
export function mountRestaurantField(host:RestaurantHost,element:HTMLElement,current:()=>RestaurantLink,path:()=>Patch['path']):RestaurantField{
  const input=element.querySelector<HTMLInputElement>('[data-restaurant-input]')!,trigger=element.querySelector<HTMLButtonElement>('[data-restaurant-picker]')!,unlink=element.querySelector<HTMLButtonElement>('[data-unlink-restaurant]')!,controller=new AbortController();
  const act=(change:()=>void)=>{try{change();}catch(error){host.error(error);}};
  const paths=()=>[[...path(),'restaurant'],[...path(),'restaurantText']] as Patch['path'][];
  const refresh=(disabled=false)=>{
    if(input!==document.activeElement)input.value=restaurantName(host.book(),current());
    input.disabled=disabled;trigger.disabled=disabled;unlink.disabled=disabled||!restaurantName(host.book(),current());
    if(disabled)popup.close();
  };
  const popup=mountDropdownPopup(trigger,'Restaurants',(panel,position,close)=>{
    const view=mountDropdownOptions(panel,{choices:host.book().foodCapture?.restaurants??[],name:'Restaurants',value:item=>item.name,selected:item=>item.id===current().restaurant,position,
      choose:item=>act(()=>{if(host.write('Choose restaurant',paths(),()=>{
        if(!host.book().foodCapture?.restaurants.some(restaurant=>restaurant.id===item.id))throw Error('This restaurant was removed. Reopen the picker.');
        const link=current();link.restaurant=item.id;delete link.restaurantText;
      })){close();refresh();host.changed();}})});
    view.search.focus({preventScroll:true});return view.dispose;
  },320);
  const edit=()=>{
    if(host.write('Edit restaurant',paths(),()=>{const link=current();link.restaurantText=input.value;delete link.restaurant;}))refresh();
  };
  input.addEventListener('input',event=>{if(!(event instanceof InputEvent&&event.isComposing))act(edit);},{signal:controller.signal});
  input.addEventListener('compositionend',()=>act(edit),{signal:controller.signal});
  input.addEventListener('change',()=>act(()=>{if(host.write('Save restaurant',[['foodCapture','restaurants'],...paths()],()=>setRestaurant(host.book(),current(),input.value))){refresh();host.changed();}}),{signal:controller.signal});
  unlink.onclick=()=>act(()=>{if(host.write('Unlink restaurant',paths(),()=>{const link=current();delete link.restaurant;delete link.restaurantText;})){input.value='';refresh();host.changed();}});
  refresh();return{refresh,dispose:()=>{popup.close();controller.abort();unlink.onclick=null;}};
}
export function showRestaurants(host:RestaurantHost):void{
  const act=(change:()=>void)=>{try{change();}catch(error){host.error(error);}};
  host.dialog('Restaurants','<p class="muted">Renaming updates linked Logged and Draft foods. Deleting a picker entry preserves each food and its existing restaurant text.</p><div data-restaurant-list></div>',dialog=>{
    const target=dialog.querySelector<HTMLElement>('[data-restaurant-list]')!;
    const draw=()=>{
      target.replaceChildren();
      for(const restaurant of host.book().foodCapture?.restaurants??[]){
        const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),rename=document.createElement('button'),remove=document.createElement('button');
        row.className='button-row';label.className='capture-restaurant-name';label.textContent='Restaurant';input.value=restaurant.name;input.setAttribute('aria-label','Restaurant name');label.append(input);
        rename.type=remove.type='button';rename.textContent='Rename';remove.textContent='Delete';remove.className='danger';row.append(label,rename,remove);target.append(row);
        rename.onclick=()=>act(()=>{if(host.write('Rename restaurant',[['foodCapture','restaurants']],()=>renameRestaurant(host.book(),restaurant.id,input.value))){draw();host.changed();}});
        remove.onclick=()=>act(()=>{
          const book=host.book(),revision=book.revision,affected=restaurantFoods(book,restaurant.id,host.engine());
          host.dialog('Delete restaurant?',`<p>Remove ${esc(restaurant.name)} from the picker? All affected foods remain; their restaurant text is preserved but unlinked.</p><ul>${affected.map(food=>`<li>${esc(food.name)} · ${food.kind}</li>`).join('')||'<li>No linked foods.</li>'}</ul><div class="button-row"><button type="button" data-cancel>Cancel</button><button type="button" class="danger" data-delete>Delete restaurant</button></div>`,confirmation=>{
            confirmation.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick=()=>confirmation.close();
            confirmation.querySelector<HTMLButtonElement>('[data-delete]')!.onclick=()=>act(()=>{
              if(host.book()!==book||book.revision!==revision)throw Error('Foods or restaurants changed. Close and reopen the restaurant deletion review.');
              if(host.write('Delete restaurant',[['foodCapture','restaurants'],['foodCapture','foods'],['foodCapture','loggedDetails']],()=>deleteRestaurant(host.book(),restaurant.id))){confirmation.close();draw();host.changed();}
            });
          });
        });
      }
      if(!target.children.length)target.textContent='Enter a restaurant in a Logged or Draft food to add it to this picker.';
    };draw();
  });
}
