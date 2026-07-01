# warrior.blend.py — build a low-poly Warrior (helmet, sword, shield) with a
# walk cycle, and export it as a .glb for the game's GLTF unit loader.
#   "blender.exe" --background --python tools/warrior.blend.py -- <out.glb>
# Conventions matching the archer: front faces -Y; tunic + shield face use the
# material named "Owner" (tinted per civ); legs pivot at the hip and are
# keyframed into a walk clip. The sword arm is a named object "SwordArm" (pivot
# at the shoulder) that the game rotates procedurally for a melee swing.
import bpy, sys, math
from mathutils import Matrix

def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()

# Parent while preserving the child's world transform (so it doesn't jump when
# the parent is offset/rotated); it still follows the parent for animation.
def parent_keep(child, parent):
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

_mats = {}
def mat(name, rgba, rough=0.8):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = rgba
        b.inputs['Roughness'].default_value = rough
        if 'Metallic' in b.inputs: b.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = rgba; _mats[name] = m; return m

def setmat(o, m): o.data.materials.clear(); o.data.materials.append(m)
def cube(sx, sy, sz, loc, m, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.scale = (sx, sy, sz); setmat(o, m); return o
def cyl(r, h, loc, m, verts=8, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object; setmat(o, m); return o
def cone(r1, r2, h, loc, m, verts=8, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object; setmat(o, m); return o
def sph(r, loc, m, subd=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subd, radius=r, location=loc)
    o = bpy.context.active_object; setmat(o, m); return o

# A limb whose ORIGIN sits at a pivot (top), geometry hanging below.
def limb(r, h, pivot, m, drop, rot=(0,0,0)):
    o = cyl(r, h, pivot, m, rot=rot)
    o.data.transform(Matrix.Translation((0, 0, -drop)))
    return o

clear()
OWNER = mat('Owner', (0.23, 0.47, 0.82, 1))
SKIN  = mat('Skin',  (0.90, 0.72, 0.55, 1))
STEEL = mat('Steel', (0.72, 0.75, 0.80, 1))
DARK  = mat('Dark',  (0.26, 0.28, 0.32, 1))
GRIP  = mat('Grip',  (0.35, 0.24, 0.14, 1))
WOOD  = mat('Wood',  (0.50, 0.35, 0.19, 1))

# legs (animated) with boots parented on
legL = limb(0.09, 0.8, (0.12, 0, 0.86), OWNER, 0.42)
legR = limb(0.09, 0.8, (-0.12, 0, 0.86), OWNER, 0.42)
bootL = cube(0.24, 0.36, 0.16, (0.12, -0.06, 0.08), DARK); parent_keep(bootL, legL)
bootR = cube(0.24, 0.36, 0.16, (-0.12, -0.06, 0.08), DARK); parent_keep(bootR, legR)

parts = []
parts += [cone(0.32, 0.26, 0.32, (0, 0, 1.0), OWNER)]        # tunic skirt
parts += [cone(0.27, 0.19, 0.62, (0, 0, 1.34), OWNER)]       # torso
parts += [cyl(0.28, 0.1, (0, 0, 1.04), DARK, verts=12)]      # belt
parts += [sph(0.13, (0.22, 0, 1.52), STEEL), sph(0.13, (-0.22, 0, 1.52), STEEL)]  # pauldrons
parts += [sph(0.17, (0, 0.02, 1.68), SKIN)]                  # head
parts += [cone(0.2, 0.12, 0.24, (0, 0.02, 1.84), STEEL)]     # helmet dome
parts += [cube(0.06, 0.06, 0.2, (0, 0.02, 2.0), OWNER)]      # helmet crest (owner colour)

# shield on the left arm (static)
parts += [limb(0.05, 0.34, (-0.24, -0.04, 1.42), SKIN, 0.16, rot=(math.radians(30), 0, 0))]  # shield arm
shieldFace = cyl(0.22, 0.05, (-0.3, -0.28, 1.2), OWNER, verts=16, rot=(math.radians(90), 0, 0))  # civ-colour face
parts += [shieldFace]
parts += [cyl(0.24, 0.03, (-0.3, -0.25, 1.2), STEEL, verts=16, rot=(math.radians(90), 0, 0))]     # rim (behind)
parts += [sph(0.05, (-0.3, -0.33, 1.2), STEEL)]              # boss

# faceted shading on everything so far
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.shade_flat(); o.select_set(False)

# --- weapon arm (named, pivots at the shoulder; game swings it) -------------
weaponArm = limb(0.055, 0.4, (0.24, 0, 1.44), SKIN, 0.2, rot=(math.radians(-20), 0, 0))
weaponArm.name = 'WeaponArm'
# a blunt wooden club held upright from the hand (~0.26,-0.12,1.06)
club = []
club += [cyl(0.032, 0.42, (0.26, -0.12, 1.2), GRIP)]                            # handle (darker wood)
club += [cone(0.07, 0.095, 0.28, (0.26, -0.12, 1.56), WOOD)]                    # blunt head (widens up)
club += [sph(0.095, (0.26, -0.12, 1.72), WOOD)]                                 # rounded top
for s in club:
    bpy.context.view_layer.objects.active = s; s.select_set(True); bpy.ops.object.shade_flat(); s.select_set(False)
    parent_keep(s, weaponArm)   # swings with the arm, but stays in the hand

# root empty parents the whole figure
root = bpy.data.objects.new('Warrior', None); bpy.context.collection.objects.link(root)
for o in parts + [legL, legR, weaponArm]:
    if o.parent is None: o.parent = root

# --- walk cycle: swing legs + body bob/sway --------------------------------
def kf(f, aL, aR, bob, sway):
    legL.rotation_euler = (math.radians(aL), 0, 0); legR.rotation_euler = (math.radians(aR), 0, 0)
    root.location = (0, 0, bob); root.rotation_euler = (0, 0, math.radians(sway))
    legL.keyframe_insert('rotation_euler', frame=f); legR.keyframe_insert('rotation_euler', frame=f)
    root.keyframe_insert('location', frame=f); root.keyframe_insert('rotation_euler', frame=f)
kf(1, 20, -20, 0.0, 3); kf(7, 0, 0, 0.05, 0); kf(13, -20, 20, 0.0, -3); kf(19, 0, 0, 0.05, 0); kf(25, 20, -20, 0.0, 3)
sc = bpy.context.scene; sc.frame_start = 1; sc.frame_end = 25

out = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_animations=True, export_animation_mode='SCENE', export_frame_range=True)
print('EXPORTED_OK', out)
