"use strict";

const exec = require('child_process').exec;
const fs = require('fs-extra');
const path = require('path');
const padLeft = require('pad-left');
const mkdirp = require('mkdirp');
const {ncp} = require('ncp');
const uuid = require('uuid/v1');

const now = new Date;
const strDate = [
    now.getFullYear(),
    padLeft(now.getMonth() + 1, 2, '0'),
    padLeft(now.getDate(), 2, '0'),
    padLeft(now.getHours(), 2, '0') + '' + padLeft(now.getMinutes(), 2, '0') + '' + padLeft(now.getSeconds(), 2, '0')
].join('-');

// --------------------------------------------------------------------------------------------------------------------
// SCRIPT CONFIGURATION
// --------------------------------------------------------------------------------------------------------------------

const buildFolder = 'build';
const destFolder = `scorm-builds/${strDate}-safran`;
const destFolderFull = path.normalize(`${__dirname}/../scorm-builds/${strDate}-safran`);
const scormFilesFolder = 'tools/scorm-files';

const appId = 'reversed.url.app.id' + uuid();
const appOrganisation = 'organisation';
const appTitle = 'App Title';
const moduleNames = {
    "0": "0 - Introduction",
};

// --------------------------------------------------------------------------------------------------------------------
//
// --------------------------------------------------------------------------------------------------------------------

// filter out non-existing modules
let moduleNamesFiltered = {};
Object.keys(moduleNames).map(key => {
    if (fs.existsSync(`${buildFolder}/module-${key}.html`)) moduleNamesFiltered[key] = moduleNames[key];
});

// create new folder
createDestFolders(destFolder, moduleNamesFiltered)

// copy all basic XML files
    .then(() => {
        return Promise.all(Object.keys(moduleNamesFiltered).map(key => {
            const xmlFiles = [
                'XMLSchema.dtd',
                'imsss_v1p0.xsd',
                'adlnav_v1p3.xsd',
                'imsss_v1p0util.xsd',
                'imsss_v1p0control.xsd',
                'imsss_v1p0random.xsd',
                'imscp_v1p1.xsd',
                'imsss_v1p0delivery.xsd',
                'datatypes.dtd',
                'imsss_v1p0limit.xsd',
                'adlcp_v1p3.xsd',
                'xml.xsd',
                'imsss_v1p0auxresource.xsd',
                'imsss_v1p0seqrule.xsd',
                'adlseq_v1p3.xsd',
                'imsss_v1p0rollup.xsd',
                'imsss_v1p0objective.xsd',
            ];

            console.log("export module", key);

            return Promise
            // copy all base files to each folder
                .all(xmlFiles.map(f => copy(`${scormFilesFolder}/${f}`, `${destFolder}/module_${key}/${f}`)))

                // copy all assets from buildFolder
                .then(() => {
                    let modules = [];
                    let files = [];
                    fs.readdirSync(buildFolder).forEach(node => {
                        const item = `${buildFolder}/${node}`;
                        if (fs.lstatSync(item).isDirectory()) {
                            if (-1 < ['common', 'components'].indexOf(node) || (new RegExp(`^module_${key}$`)).test(node)) {
                                if ((new RegExp(`^module_${key}$`)).test(node)) {
                                    // delete views folder from the modules
                                    if (fs.existsSync(`${item}/views`)) fs.removeSync(`${item}/views`);

                                    // save module name
                                    modules.push(node);
                                }

                                files.push(node);
                            }
                        } else if (fs.lstatSync(item).isFile()) {
                            if ((new RegExp(`^module-${key}\.html$`)).test(node)) {
                                files.push(node);
                            }
                        }
                    });

                    // copy all files and return modules to the next promise
                    return Promise
                        .all(files.map(f => copy(`${buildFolder}/${f}`, `${destFolder}/module_${key}/${f}`)))
                        .then(() => modules);
                })

                // generate common / components as shared deps
                .then(modules => {
                    let menus = [];
                    let resources = [];

                    modules.forEach((module, index) => {
                        const moduleFolder = module;
                        const moduleFile = module.replace('_', '-') + '.html';
                        const menuId = 'item_' + padLeft(index, 3, '0');
                        const resourceId = 'resource_' + padLeft(index, 3, '0');
                        const moduleTitle = moduleNames[key];

                        // Build menu markup
                        let menu = [];
                        menu.push(`<item identifier="${menuId}" identifierref="${resourceId}">`);
                        menu.push(`\t<title>${moduleTitle}</title>`);
                        menu.push(`\t<imsss:sequencing>`);
                        menu.push(`\t\t<imsss:objectives>`);
                        menu.push(`\t\t\t<imsss:primaryObjective objectiveID="PRIMARYOBJ" satisfiedByMeasure="true">`);
                        menu.push(`\t\t\t\t<imsss:minNormalizedMeasure>0.8</imsss:minNormalizedMeasure>`);
                        menu.push(`\t\t\t</imsss:primaryObjective>`);
                        menu.push(`\t\t</imsss:objectives>`);
                        menu.push(`\t\t<imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>`);
                        menu.push(`\t</imsss:sequencing>`);
                        menu.push(`</item>`);

                        // add to all menus
                        menus.push(menu.join("\n"));

                        // Build resource markup
                        let resource = [];
                        resource.push(`<resource identifier="${resourceId}" type="webcontent" href="${moduleFile}" adlcp:scormType="sco">`);
                        resource.push(`\t<file href="${moduleFile}"/>`);
                        scan(`${destFolder}/module_${key}/${moduleFolder}`).map(f => {
                            resource.push(`\t<file href="${f.replace(`${destFolder}/module_${key}/`, '')}"/>`);
                        });
                        resource.push(`\t<dependency identifierref="common_files"/>`);
                        resource.push(`</resource>`);

                        // add to all resources
                        resources.push(resource.join("\n"));
                    });

                    // Build common_files markup
                    let common = [];
                    common.push(`<resource identifier="common_files" type="webcontent" adlcp:scormType="asset">`);
                    scan(`${destFolder}/module_${key}/common`).map(f => {
                        common.push(`\t<file href="${f.replace(`${destFolder}/module_${key}/`, '')}"/>`);
                    });
                    scan(`${destFolder}/module_${key}/components`).map(f => {
                        common.push(`\t<file href="${f.replace(`${destFolder}/module_${key}/`, '')}"/>`);
                    });
                    common.push(`</resource>`);

                    // add to all resources
                    resources.push(common.join("\n"));

                    // Build manifest
                    let manifest = [];
                    manifest.push('<?xml version="1.0" encoding="utf-8" standalone="no"?>');
                    manifest.push(`<manifest identifier="${appId}" version="1" xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">`);
                    manifest.push('<metadata>');
                    manifest.push('<schema>ADL SCORM</schema>');
                    manifest.push('<schemaversion>2004 4th Edition</schemaversion>');
                    manifest.push('</metadata>');
                    manifest.push(`<organizations default="${appOrganisation}">`);
                    manifest.push(`<organization identifier="${appOrganisation}">`);
                    manifest.push(`<title>${appTitle}</title>`);
                    manifest.push(menus.join("\n"));
                    manifest.push('<imsss:sequencing>');
                    manifest.push('<imsss:controlMode choice="true" flow="true"/>');
                    manifest.push('</imsss:sequencing>');
                    manifest.push('</organization>');
                    manifest.push('</organizations>');
                    manifest.push('<resources>');
                    manifest.push(resources.join("\n"));
                    manifest.push('</resources>');
                    manifest.push('</manifest>');

                    // write the manifest file
                    if (fs.existsSync(`${destFolder}/module_${key}/imsmanifest.xml`)) {
                        fs.removeSync(`${destFolder}/module_${key}/imsmanifest.xml`);
                    }

                    fs.writeFileSync(`${destFolder}/module_${key}/imsmanifest.xml`, manifest.join("\n"), {encoding: 'utf8'});
                })

                // zip!
                .then(() => {
                    return new Promise((resolve, reject) => {
                        exec(`zip -r ../../${strDate}-safran-${key}.zip .`, {cwd: `${destFolderFull}/module_${key}`}, (err, stdout, stderr) => {
                            if (err) return reject(err);
                            if (stderr) return reject(stderr);
                            resolve(stdout);
                        });
                    });
                })

        }));
    })

    // We're done
    .then(() => {
        console.log("> done !");
    })

    // catch errors
    .catch(console.log);

/**
 * Create the destination folder
 * @param folder
 * @param modules
 * @return {Promise}
 */
function createDestFolders(folder, modules = []) {
    let promises = [];

    Object.keys(modules).map(key => {
        promises.push(new Promise((resolve, reject) => {
            const name = `module_${key}`;
            // console.log("> mkdir", `${folder}/${name}`);
            mkdirp(`${folder}/${name}`, err => err ? reject(err) : resolve());
        }));
    });

    return Promise.all(promises);
}

/**
 * Copy a file or a folder recursively
 * @param source
 * @param destination
 * @return {Promise}
 */
function copy(source, destination) {
    return new Promise((resolve, reject) => {
        // console.log("> copy", source);
        ncp(source, destination, err => err ? reject(err) : resolve());
    });
}

/**
 * Scan an entry point for files
 * Return an array with all the paths
 *
 * @param folder
 * @param bucket
 * @return {Array}
 */
function scan(folder, bucket = []) {
    fs.readdirSync(folder).forEach(node => {
        const item = `${folder}/${node}`;
        if (fs.lstatSync(item).isDirectory()) {
            scan(item, bucket);
        } else {
            // skip hidden files
            if (/^\./.test(item)) return;

            bucket.push(item);
        }
    });

    return bucket;
}
