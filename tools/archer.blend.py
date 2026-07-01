# archer.blend.py — build a low-poly Archer and export it as a .glb for the
# game's GLTF unit loader. Run headless:
#   "blender.exe" --background --python tools/archer.blend.py -- <out.glb>
# The tunic material is named "Owner" so the game can tint it per civilisation.
import bpy, sys, math

def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

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

def torus(maj, mino, loc, m, rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=maj, minor_radius=mino, location=loc, rotation=rot, major_segments=12, minor_segments=6)
    o = bpy.context.active_object; setmat(o, m); return o

def bow(loc, m, thick=0.022):
    # a C-shaped bow: a Bezier arc (tips near the archer, belly toward the
    # target) given thickness with a round bevel, converted to a mesh.
    cu = bpy.data.curves.new('bow', 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = thick; cu.bevel_resolution = 2
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(2)
    pts = [(0, 0.06, 0.40), (0, -0.20, 0.0), (0, 0.06, -0.40)]  # top tip, belly, bottom tip
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co; bp.handle_left_type = 'AUTO'; bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('Bow', cu); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.location = loc; setmat(o, m); return o

clear()

OWNER = mat('Owner', (0.23, 0.47, 0.82, 1))   # tunic — tinted per civ in-game
SKIN  = mat('Skin',  (0.90, 0.72, 0.55, 1))
WOOD  = mat('Wood',  (0.42, 0.30, 0.16, 1))
TRIM  = mat('Trim',  (0.88, 0.88, 0.90, 1))
DARK  = mat('Dark',  (0.28, 0.30, 0.34, 1))

# Front is -Y. Figure stands on z=0, ~1.9 tall.
# legs + boots
for sx in (0.12, -0.12):
    cyl(0.085, 0.8, (sx, 0, 0.44), OWNER)
    cube(0.22, 0.34, 0.16, (sx, -0.06, 0.08), DARK)   # boot
# hips / tunic skirt
cone(0.30, 0.24, 0.30, (0, 0, 0.98), OWNER)
# torso
cone(0.25, 0.17, 0.6, (0, 0, 1.32), OWNER)
# belt
cyl(0.255, 0.09, (0, 0, 1.02), DARK, verts=12)
# shoulders
sph(0.12, (0.2, 0, 1.5), OWNER); sph(0.12, (-0.2, 0, 1.5), OWNER)
# head + pointed hood
sph(0.17, (0, 0.02, 1.66), SKIN)
cone(0.2, 0.0, 0.26, (0, 0.02, 1.82), TRIM)
# quiver on the back with fletched arrows poking out
cyl(0.075, 0.44, (0.12, 0.18, 1.32), WOOD, rot=(math.radians(12), 0, 0))
for dx in (-0.03, 0.03, 0.0):
    cone(0.03, 0.0, 0.12, (0.12 + dx, 0.2, 1.6), TRIM)

# bow arm reaching forward, draw arm bent back
cyl(0.055, 0.5, (0.12, -0.2, 1.32), SKIN, rot=(math.radians(70), 0, 0))   # front (bow) arm
cyl(0.055, 0.36, (-0.16, 0.06, 1.36), SKIN, rot=(math.radians(-35), 0, 0)) # rear (draw) arm

# the bow: a C-shaped arc held in front (belly toward the target), a straight
# bowstring joining the tips, and a nocked arrow resting on the string
bow((0.06, -0.30, 1.18), WOOD)
cyl(0.008, 0.80, (0.06, -0.24, 1.18), DARK, verts=6)                          # bowstring (tip-to-tip chord)
cyl(0.014, 0.46, (0.06, -0.47, 1.18), WOOD, rot=(math.radians(90), 0, 0))     # arrow shaft
cone(0.028, 0.0, 0.1, (0.06, -0.72, 1.18), TRIM, rot=(math.radians(-90), 0, 0))  # arrowhead
sph(0.05, (0.06, -0.46, 1.18), SKIN)                                          # bow-hand grip

# faceted low-poly look
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_flat()

out = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print('EXPORTED_OK', out)
