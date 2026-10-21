import * as THREE from 'three';

// Arms and the gun share one depth buffer, but not the world's. A wall a few
// centimetres from the camera must still stop bullets, not erase a sleeve each
// time the collision camera moves. Never disable depth tests on shared assets.
export class FirstPersonPass {
  constructor(){
    this.scene=new THREE.Scene();
    this.matrix=new THREE.Matrix4();
    this.lightingRoot=null;this.lights=[];
  }
  syncLighting(world,root){
    root ||= world;
    if(this.lightingRoot!==root){
      for(const {copy} of this.lights){this.scene.remove(copy);if(copy.target)this.scene.remove(copy.target);}
      this.lights=[];this.lightingRoot=root;
      world.traverse(source=>{
        if(!source.isAmbientLight&&!source.isHemisphereLight&&!source.isDirectionalLight&&!source.isPointLight)return;
        const copy=source.clone();copy.castShadow=false;
        this.scene.add(copy);if(copy.target)this.scene.add(copy.target);
        this.lights.push({source,copy});
      });
    }
    for(const {source,copy} of this.lights){
      copy.color.copy(source.color);copy.intensity=source.intensity;copy.visible=source.visible;
      copy.position.setFromMatrixPosition(source.matrixWorld);
      if(copy.isPointLight){copy.distance=source.distance;copy.decay=source.decay;}
      if(copy.groundColor)copy.groundColor.copy(source.groundColor);
      if(copy.target){source.target.updateWorldMatrix(true,false);copy.target.position.setFromMatrixPosition(source.target.matrixWorld);}
    }
    this.scene.environment=world.environment;
    this.scene.environmentIntensity=world.environmentIntensity;
    this.scene.fog=world.fog;
  }
  render(renderer,world,camera,viewmodel,lightingRoot){
    const visible=viewmodel.visible;
    viewmodel.visible=false;
    try{renderer.render(world,camera);}finally{viewmodel.visible=visible;}
    if(!visible)return;
    this.syncLighting(world,lightingRoot);
    const parent=viewmodel.parent,autoUpdate=viewmodel.matrixAutoUpdate,autoClear=renderer.autoClear;
    if(autoUpdate)viewmodel.updateMatrix();
    this.matrix.copy(viewmodel.matrix);
    // Temporarily use the existing camera-space pose as a world matrix. Restore
    // it exactly (no repeated attach/decompose drift, no persistent reparenting).
    this.scene.add(viewmodel);
    if(parent)viewmodel.matrix.multiplyMatrices(parent.matrixWorld,this.matrix);
    viewmodel.matrixAutoUpdate=false;
    try{
      renderer.autoClear=false;
      renderer.clearDepth();
      renderer.render(this.scene,camera);
    }finally{
      renderer.autoClear=autoClear;
      this.scene.remove(viewmodel);if(parent)parent.add(viewmodel);
      viewmodel.matrix.copy(this.matrix);viewmodel.matrixAutoUpdate=autoUpdate;
      viewmodel.matrixWorldNeedsUpdate=true;
    }
  }
}
