# archer.blend.py — build a low-poly Archer with a walk cycle and export it as a
# .glb for the game's GLTF unit loader. Run headless:
#   "blender.exe" --background --python tools/archer.blend.py -- <out.glb>
# The tunic material is named "Owner" so the game tints it per civilisation; the
# legs pivot at the hip and are keyframed into a walk clip (exported via SCENE
# animation mode) that the game's AnimationMixer plays while the unit moves.
import bpy, sys, math
from mathutils import Matrix

def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

# Parent while preserving the child's world transform.
def parent_keep(child, parent):
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

_mats = {}
def mat(name, rgba, rough=0.85):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = rgba
        b.inputs['Roughness'].default_value = rough
        if 'Metallic' in b.inputs: b.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = rgba
    _mats[name] = m
    return m

def setmat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)

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

def bow(loc, m, thick=0.022):
    cu = bpy.data.curves.new('bow', 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = thick; cu.bevel_resolution = 2
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(2)
    pts = [(0, 0.06, 0.40), (0, -0.20, 0.0), (0, 0.06, -0.40)]
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co; bp.handle_left_type = 'AUTO'; bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('Bow', cu); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.location = loc; setmat(o, m); return o

# A leg whose ORIGIN sits at the hip (geometry hangs below), so a rotation about
# X swings the foot forward/back — the basis of the walk cycle.
def leg(x, m):
    hip = 0.86
    o = cyl(0.085, 0.8, (x, 0, hip), m)     # created centred on the hip point
    o.data.transform(Matrix.Translation((0, 0, -0.42)))  # drop geometry below the origin
    return o

clear()

OWNER = mat('Owner', (0.23, 0.47, 0.82, 1))   # tunic — tinted per civ in-game
SKIN  = mat('Skin',  (0.90, 0.72, 0.55, 1))
WOOD  = mat('Wood',  (0.42, 0.30, 0.16, 1))
TRIM  = mat('Trim',  (0.88, 0.88, 0.90, 1))
DARK  = mat('Dark',  (0.28, 0.30, 0.34, 1))

parts = []
# legs (animated) + boots parented to them
legL = leg(0.12, OWNER); legR = leg(-0.12, OWNER)
bootL = cube(0.22, 0.34, 0.16, (0.12, -0.06, 0.08), DARK)
bootR = cube(0.22, 0.34, 0.16, (-0.12, -0.06, 0.08), DARK)
parent_keep(bootL, legL); parent_keep(bootR, legR)   # boots swing with their leg, stay on the foot
# body
parts += [cone(0.30, 0.24, 0.30, (0, 0, 0.98), OWNER)]      # tunic skirt
parts += [cone(0.25, 0.17, 0.6, (0, 0, 1.32), OWNER)]       # torso
parts += [cyl(0.255, 0.09, (0, 0, 1.02), DARK, verts=12)]   # belt
parts += [sph(0.12, (0.2, 0, 1.5), OWNER), sph(0.12, (-0.2, 0, 1.5), OWNER)]  # shoulders
parts += [sph(0.17, (0, 0.02, 1.66), SKIN)]                 # head
parts += [cone(0.2, 0.0, 0.26, (0, 0.02, 1.82), TRIM)]      # hood
parts += [cyl(0.075, 0.44, (0.12, 0.18, 1.32), WOOD, rot=(math.radians(12), 0, 0))]  # quiver
for dx in (-0.03, 0.03, 0.0):
    parts += [cone(0.03, 0.0, 0.12, (0.12 + dx, 0.2, 1.6), TRIM)]  # fletching
# arms
parts += [cyl(0.055, 0.5, (0.12, -0.2, 1.32), SKIN, rot=(math.radians(70), 0, 0))]
parts += [cyl(0.055, 0.36, (-0.16, 0.06, 1.36), SKIN, rot=(math.radians(-35), 0, 0))]
# bow + string + arrow + grip
parts += [bow((0.06, -0.30, 1.18), WOOD)]
parts += [cyl(0.008, 0.80, (0.06, -0.24, 1.18), DARK, verts=6)]
parts += [cyl(0.014, 0.46, (0.06, -0.47, 1.18), WOOD, rot=(math.radians(90), 0, 0))]
parts += [cone(0.028, 0.0, 0.1, (0.06, -0.72, 1.18), TRIM, rot=(math.radians(-90), 0, 0))]
parts += [sph(0.05, (0.06, -0.46, 1.18), SKIN)]

# faceted low-poly shading on every mesh
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.context.view_layer.objects.active = o
        o.select_set(True); bpy.ops.object.shade_flat(); o.select_set(False)

# a root empty parents the whole figure so it can bob/sway as one
root = bpy.data.objects.new('Archer', None)
bpy.context.collection.objects.link(root)
for o in parts + [legL, legR]:
    if o.parent is None: o.parent = root

# --- walk cycle: swing the legs, bob & sway the body -----------------------
def kf(f, aL, aR, bob, sway):
    legL.rotation_euler = (math.radians(aL), 0, 0)
    legR.rotation_euler = (math.radians(aR), 0, 0)
    root.location = (0, 0, bob)
    root.rotation_euler = (0, 0, math.radians(sway))
    legL.keyframe_insert('rotation_euler', frame=f)
    legR.keyframe_insert('rotation_euler', frame=f)
    root.keyframe_insert('location', frame=f)
    root.keyframe_insert('rotation_euler', frame=f)

kf(1,  22, -22, 0.00,  3)
kf(7,   0,   0, 0.05,  0)
kf(13, -22, 22, 0.00, -3)
kf(19,  0,   0, 0.05,  0)
kf(25, 22, -22, 0.00,  3)   # == frame 1, for a seamless loop

sc = bpy.context.scene
sc.frame_start = 1; sc.frame_end = 25

out = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_animations=True, export_animation_mode='SCENE', export_frame_range=True)
print('EXPORTED_OK', out)
