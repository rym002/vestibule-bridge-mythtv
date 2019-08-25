import 'mocha';
import { mergeObject } from '../src/mergeObject'
import { expect } from 'chai'

class SuperChild {
    private readonly value = 'super';
    getValue() {
        return this.value;
    }
}
class ChildClass extends SuperChild {
    private readonly name = 'child'
    getName() {
        return this.name;
    }
    getNameOrig(){
        return this.name;
    }
}
class Mixed1Class {
    constructor(private readonly child: ChildClass) {

    }

    getName() {
        return this.child.getName() + ' mixed';
    }
}

class Mixed2Child {
    private readonly mixedValue = 'mixed';
    getMixed() {
        return this.mixedValue;
    }
}
describe('merge object', () => {
    let mixed: Mixed2Child & Mixed1Class & ChildClass;
    before(() => {
        const child = new ChildClass();
        const mix = new Mixed1Class(child);
        mixed = mergeObject(new Mixed2Child(), mergeObject(mix, child));
    })
    it('should call a method on the super class', () => {
        expect(mixed.getValue()).eql('super')
    })
    it('should override a method', () => {
        expect(mixed.getName()).eql('child mixed')
    })
    it('should call a mixed method', () => {
        expect(mixed.getNameOrig()).eql('child')
    })
    it('should call an implemented method', () => {
        expect(mixed.getMixed()).eql('mixed')
    })
})