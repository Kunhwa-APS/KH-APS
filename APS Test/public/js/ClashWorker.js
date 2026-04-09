/* ClashWorker.js - High-Precision Geometric Collision Worker */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/three.js/r125/three.min.js');
importScripts('https://unpkg.com/three-mesh-bvh@0.7.3/build/index.umd.cjs');

// Reuse vectors to avoid allocation
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _vE = new THREE.Vector3();
const _vF = new THREE.Vector3();
const _matA = new THREE.Matrix4();
const _matB = new THREE.Matrix4();
const _matBtoA = new THREE.Matrix4();
const _invA = new THREE.Matrix4();

// Storage for model geometry
const models = new Map();

self.onmessage = function (e) {
    const { type, data } = e.data;
    if (type === 'LOAD_MODEL') loadModel(data);
    else if (type === 'CHECK_BATCH') checkBatch(data);
    else if (type === 'PING') self.postMessage({ type: 'PONG', hasBVH: !!self.MeshBVH });
};

function loadModel({ modelId, fragments }) {
    const modelData = new Map();
    fragments.forEach(f => {
        const geometry = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(new Float32Array(f.vb), f.vbstsize || 3);
        geometry.setAttribute('position', posAttr);
        if (f.ib) {
            // Use the correct typed array based on transmitted ibType
            const indices = (f.ibType === 'uint32') ? new Uint32Array(f.ib) : new Uint16Array(f.ib);
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }

        if (self.MeshBVH) {
            geometry.boundsTree = new self.MeshBVH(geometry);
        }
        modelData.set(f.fragId, geometry);
    });
    models.set(modelId, modelData);
    self.postMessage({ type: 'LOADED', modelId });
}

// Pre-allocated axes and vectors for SAT to avoid ANY GC during narrow-phase
const _eA1 = new THREE.Vector3();
const _eA2 = new THREE.Vector3();
const _eA3 = new THREE.Vector3();
const _eB1 = new THREE.Vector3();
const _eB2 = new THREE.Vector3();
const _eB3 = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();
const _axes = [
    _nA, _nB,
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
];

function checkBatch({ batchId, candidates, tolerance, hardEpsilon }) {
    const results = [];

    for (const cand of candidates) {
        const { id, modelAId, fragA, modelBId, fragB, matA, matB } = cand;

        const geomA = models.get(modelAId)?.get(fragA);
        const geomB = models.get(modelBId)?.get(fragB);

        if (!geomA || !geomB) continue;

        _matA.fromArray(matA);
        _matB.fromArray(matB);
        _invA.copy(_matA).invert();
        _matBtoA.copy(_invA).multiply(_matB);

        const bvhA = geomA.boundsTree;
        const bvhB = geomB.boundsTree;

        if (bvhA && bvhB) {
            let record = null;
            let checkCount = 0;
            bvhA.intersectsBVH(bvhB, _matBtoA, (triA, triB) => {
                checkCount++;
                if (trianglesIntersectSAT(triA.a, triA.b, triA.c, triB.a, triB.b, triB.c, hardEpsilon)) {
                    _vA.copy(triA.a).applyMatrix4(_matA);
                    record = {
                        distance: 0,
                        isHard: true,
                        point: [_vA.x, _vA.y, _vA.z]
                    };
                    return true;
                }
                return false;
            });
            if (record) {
                results.push({ id, ...record });
            }
            if (checkCount > 0 && results.length === 0 && Math.random() < 0.01) {
                // Occasional diagnostic to see density
                // self.postMessage({ type: 'LOG', msg: `Frag ${id}: Checked ${checkCount} tris, 0 hits` });
            }
        }
    }

    self.postMessage({ type: 'BATCH_RESULT', batchId, results });
}

function trianglesIntersectSAT(a0, a1, a2, b0, b1, b2, epsilon = 0.0001) {
    _eA1.subVectors(a1, a0);
    _eA2.subVectors(a2, a1);
    _eA3.subVectors(a0, a2);
    _eB1.subVectors(b1, b0);
    _eB2.subVectors(b2, b1);
    _eB3.subVectors(b0, b2);

    _nA.crossVectors(_eA1, _eA2);
    _nB.crossVectors(_eB1, _eB2);

    if (_nA.lengthSq() < 1e-12 || _nB.lengthSq() < 1e-12) return false;

    // Direct assignment to pre-allocated axes to avoid object creation
    _axes[2].crossVectors(_eA1, _eB1);
    _axes[3].crossVectors(_eA1, _eB2);
    _axes[4].crossVectors(_eA1, _eB3);
    _axes[5].crossVectors(_eA2, _eB1);
    _axes[6].crossVectors(_eA2, _eB2);
    _axes[7].crossVectors(_eA2, _eB3);
    _axes[8].crossVectors(_eA3, _eB1);
    _axes[9].crossVectors(_eA3, _eB2);
    _axes[10].crossVectors(_eA3, _eB3);

    const triA = [a0, a1, a2];
    const triB = [b0, b1, b2];

    for (let i = 0; i < 11; i++) {
        const axis = _axes[i];
        if (axis.lengthSq() < 1e-10) continue;
        axis.normalize();

        let minA = Infinity, maxA = -Infinity;
        for (let j = 0; j < 3; j++) {
            const d = triA[j].dot(axis);
            if (d < minA) minA = d;
            if (d > maxA) maxA = d;
        }

        let minB = Infinity, maxB = -Infinity;
        for (let j = 0; j < 3; j++) {
            const d = triB[j].dot(axis);
            if (d < minB) minB = d;
            if (d > maxB) maxB = d;
        }

        if (maxA < minB - epsilon || maxB < minA - epsilon) return false;
    }
    return true;
}
