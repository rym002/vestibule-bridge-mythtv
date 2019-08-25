import {functions}  from 'lodash'

export function mergeObject<TObject extends object, TSource extends object>(src: TObject, parent: TSource): TObject & TSource {
    const d = Object.getPrototypeOf(parent);
    mergeFunctions(src, parent)
    mergeProto(src, parent, d);
    return <TObject & TSource>src;
}

function mergeFunctions(src: any, parent: any) {
    const functionNames = functions(parent);
    functionNames.forEach(functionName => {
        if (!src[functionName]) {
            src[functionName] = parent[functionName];
        }
    })
}
function mergeProto(src: any, parent: any, proto: any) {
    const keys = Object.getOwnPropertyNames(proto)
    const srcKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(src));
    const srcProps = Object.getOwnPropertyNames(src);
    keys.forEach(key => {
        if (key != 'constructor' && !srcKeys.includes(key) && !srcProps.includes(key)) {
            src[key] = parent[key].bind(parent)
        }
    })
    const childProto = proto['__proto__'];
    if (childProto && childProto['__proto__']) {
        mergeProto(src, parent, childProto);
    }
}